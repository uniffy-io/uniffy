import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Keyboard,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Image } from "expo-image";
import {
  At,
  Check,
  Code,
  Faders,
  PaperPlaneRight,
  Paperclip,
  Plus,
  Smiley,
  TextB,
  X,
} from "phosphor-react-native";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import { GlassSurface } from "@shared/components/GlassSurface";
import type { PendingAttachment } from "@features/chat/useComposerAttachments";

export type ComposerTools = {
  onEmoji: () => void;
  onMention: () => void;
  onAttach: () => void;
  onWrap: (marker: string) => void;
};

/** The model an agent DM is talking to, and the way to change it. */
export type ComposerModel = {
  label: string;
  onPress: () => void;
  /** Keeps the composer open while the picker covers it. */
  pickerOpen?: boolean;
};

// Vertical space the action row claims when the composer is open: the round
// buttons plus the padding that separates them from the input and the card
// edge. Collapsing animates this to zero, so it has to be a constant.
const ACTIONS_PAD_TOP = 4;
const ACTIONS_PAD_BOTTOM = 6;
const ACTIONS_HEIGHT = 38 + ACTIONS_PAD_TOP + ACTIONS_PAD_BOTTOM;
// Applied per state rather than in the stylesheet: the collapsed row must take
// no room at all, and padding is the one thing a zero height cannot remove.
const ACTIONS_PADDING = {
  height: ACTIONS_HEIGHT,
  paddingTop: ACTIONS_PAD_TOP,
  paddingBottom: ACTIONS_PAD_BOTTOM,
} as const;
const ACTIONS_COLLAPSED = { height: 0, paddingTop: 0, paddingBottom: 0 } as const;
const COLLAPSE_MS = 160;
const LINE_HEIGHT = 21;
// Height the 15pt face actually draws on with no leading and no font padding.
// The collapsed field centres its single line against this, so it is the knob
// to turn if the placeholder sits high or low in the pill.
const NATURAL_LINE_HEIGHT = 18;
// Slack around that single line. Splitting it evenly is what centres the text,
// so the field is this much taller than the line it holds - no more, or the
// resting pill stops being slim.
const COLLAPSED_SLACK = 4;

/**
 * The one-line metrics at the reader's text size. Every number here is authored
 * for the unscaled face, and React Native scales fontSize with the OS text-size
 * setting but never a lineHeight or a height given in a style - so leaving these
 * fixed would let the glyphs outgrow the field and crop the draft.
 */
function collapsedMetrics(fontScale: number) {
  const line = Math.round(NATURAL_LINE_HEIGHT * fontScale);
  return { line, height: line + COLLAPSED_SLACK, padTop: COLLAPSED_SLACK / 2 };
}

// Rounded composer card: input on top, action row below. The + button
// holds the formatting tools; the input grows to 7 rows, then scrolls.
// At rest the card is a bare one-line pill - the + and send buttons only
// unfold once the input is engaged, so browsing a channel is not taxed with
// controls that have nothing to act on yet.
export function ChatComposer({
  T,
  inputRef,
  draft,
  onChangeDraft,
  onSelectionChange,
  placeholder,
  canSend,
  editing = false,
  onSend,
  tools,
  model,
  attachments = [],
  onRemoveAttachment,
}: {
  T: ThemeColors & { isDark: boolean };
  inputRef?: React.RefObject<TextInput | null>;
  draft: string;
  onChangeDraft: (text: string) => void;
  onSelectionChange?: (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => void;
  placeholder: string;
  canSend: boolean;
  editing?: boolean;
  onSend: () => void;
  tools: ComposerTools;
  model?: ComposerModel;
  attachments?: PendingAttachment[];
  onRemoveAttachment?: (localId: string) => void;
}) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const reducedMotion = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  const collapsed = collapsedMetrics(fontScale);

  // Anything the action row could still act on keeps it open. toolsOpen matters
  // most: reaching the emoji picker, the @ overlay or the attach sheet blurs the
  // input, and the composer must not fold away underneath the sheet the user
  // just asked for.
  const expanded = focused || toolsOpen || editing || draft.length > 0 || attachments.length > 0;

  // Tapping the message list or the Android back key hides the keyboard without
  // always blurring the input, which would leave the composer open with a live
  // cursor - and a second tap on an already-focused input fires no onFocus, so
  // it could never be re-expanded. Blurring on hide keeps the two in step.
  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidHide", () => {
      setFocused(false);
      inputRef?.current?.blur();
    });
    return () => sub.remove();
  }, [inputRef]);

  // Opening the model picker blurs the input, so the keyboard has to be asked
  // back once the picker is gone - the pill is only reachable from the open
  // composer, so the user was mid-compose either way.
  const pickerWasOpen = useRef(false);
  useEffect(() => {
    const open = !!model?.pickerOpen;
    if (pickerWasOpen.current && !open) inputRef?.current?.focus();
    pickerWasOpen.current = open;
  }, [model?.pickerOpen, inputRef]);

  const progress = useSharedValue(expanded ? 1 : 0);
  useEffect(() => {
    const target = expanded ? 1 : 0;
    // A shared value is a mutable UI-thread box; assigning `.value` is the only
    // way to drive it, and it is deliberately outside React's render state.
    // eslint-disable-next-line react/react-compiler
    progress.value = reducedMotion ? target : withTiming(target, { duration: COLLAPSE_MS });
  }, [expanded, reducedMotion, progress]);

  // The row's height flips in one step rather than animating: it is a layout
  // fact, and the screen measures this card to inset the message list, so an
  // animated height re-measured the composer - and pushed the transcript - on
  // every frame of the open. That churn is what made the expansion stutter.
  // The fade and lift carry the motion instead, entirely on the UI thread.
  //
  // Transforms are safe here only because the row is a SIBLING of the card's
  // GlassSurface: an animated transform on any ancestor of a GlassView
  // silently degrades it to a plain view (expo/expo#41024).
  const actionsStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 8 }],
  }));

  return (
    <View style={[styles.card, { borderColor: T.border }]}>
      <GlassSurface
        style={StyleSheet.absoluteFill}
        tintColor={T.isDark ? "rgba(20,22,34,0.5)" : "rgba(255,255,255,0.5)"}
        interactive
        isDark={T.isDark}
        blurIntensity={40}
        solidColor={T.isDark ? "rgba(22,24,36,0.78)" : "rgba(248,249,252,0.82)"}
      />
      {attachments.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.attachBarContent}
          keyboardShouldPersistTaps="handled"
        >
          {attachments.map((p) => (
            <View
              key={p.localId}
              style={[
                styles.attachChip,
                { backgroundColor: T.bg, borderColor: p.error ? T.red : T.border },
              ]}
            >
              {p.mimeType.startsWith("image/") ? (
                <Image source={{ uri: p.uri }} style={styles.attachThumb} contentFit="cover" />
              ) : (
                <Paperclip size={16} color={T.textDim} weight="bold" />
              )}
              <View style={styles.attachInfo}>
                <Text numberOfLines={1} style={[styles.attachName, { color: T.textBright }]}>
                  {p.filename}
                </Text>
                <Text style={[styles.attachStatus, { color: p.error ? T.red : T.textDim }]}>
                  {p.error ? "Failed" : p.fileId ? "Ready" : `${p.progress}%`}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => onRemoveAttachment?.(p.localId)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <X size={14} color={T.textDim} weight="bold" />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      ) : null}

      <TextInput
        ref={inputRef}
        value={draft}
        onChangeText={onChangeDraft}
        onSelectionChange={onSelectionChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={T.textDim}
        style={[
          styles.input,
          expanded
            ? [styles.inputExpanded, { lineHeight: Math.round(LINE_HEIGHT * fontScale) }]
            : [styles.inputCollapsed, { height: collapsed.height, paddingTop: collapsed.padTop }],
          { color: T.textBright },
        ]}
        multiline
      />

      <Animated.View
        style={[
          styles.actions,
          // Padding survives a height of 0 - a box is never shorter than its own
          // padding - so a collapsed row still stood 10 tall under the field,
          // heightening the pill and hanging its placeholder above centre.
          expanded ? ACTIONS_PADDING : ACTIONS_COLLAPSED,
          actionsStyle,
        ]}
        pointerEvents={expanded ? "auto" : "none"}
        accessibilityElementsHidden={!expanded}
        importantForAccessibility={expanded ? "auto" : "no-hide-descendants"}
      >
        <TouchableOpacity
          style={[styles.roundBtn, { backgroundColor: T.bg, borderColor: T.border }]}
          onPress={() => setToolsOpen((v) => !v)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={toolsOpen ? "Hide formatting options" : "Formatting options"}
        >
          {toolsOpen ? (
            <X size={18} color={T.text} weight="bold" />
          ) : (
            <Plus size={18} color={T.text} weight="bold" />
          )}
        </TouchableOpacity>
        {toolsOpen ? (
          <View style={styles.toolRow}>
            <ToolButton onPress={tools.onEmoji}>
              <Smiley size={20} color={T.textDim} weight="regular" />
            </ToolButton>
            <ToolButton onPress={tools.onMention}>
              <At size={20} color={T.textDim} weight="bold" />
            </ToolButton>
            <ToolButton onPress={tools.onAttach}>
              <Paperclip size={20} color={T.textDim} weight="bold" />
            </ToolButton>
            <ToolButton onPress={() => tools.onWrap("**")}>
              <TextB size={19} color={T.textDim} weight="bold" />
            </ToolButton>
            <ToolButton onPress={() => tools.onWrap("`")}>
              <Code size={19} color={T.textDim} weight="bold" />
            </ToolButton>
          </View>
        ) : null}
        <View style={styles.spacer} />
        {model ? (
          <TouchableOpacity
            style={[styles.modelChip, { backgroundColor: T.bg, borderColor: T.border }]}
            onPress={model.onPress}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Model: ${model.label}. Change model`}
          >
            <Faders size={13} color={T.textDim} weight="bold" />
            <Text style={[styles.modelChipText, { color: T.textDim }]} numberOfLines={1}>
              {model.label}
            </Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={[
            styles.roundBtn,
            styles.sendBtn,
            { backgroundColor: canSend ? T.accent : T.surfaceHover },
          ]}
          onPress={onSend}
          disabled={!canSend}
          activeOpacity={0.8}
        >
          {editing ? (
            <Check size={18} color={canSend ? "#fff" : T.textDim} weight="bold" />
          ) : (
            <PaperPlaneRight size={18} color={canSend ? "#fff" : T.textDim} weight="fill" />
          )}
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

function ToolButton({ onPress, children }: { onPress: () => void; children: React.ReactNode }) {
  return (
    <TouchableOpacity
      style={styles.toolBtn}
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      activeOpacity={0.6}
    >
      {children}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    // Matches the bottom bar's inset so the two floating pills share an edge.
    marginHorizontal: 18,
    marginTop: 3,
    marginBottom: 5,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    paddingHorizontal: 12,
    // Even top and bottom: the resting pill holds a single line, so any
    // imbalance here shows up directly as an off-centre placeholder.
    paddingTop: 6,
    paddingBottom: 6,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    // The buttons keep their intrinsic size while the row's height animates to
    // zero, so the collapse has to clip them rather than squash them.
    overflow: "hidden",
  },
  toolRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  toolBtn: { padding: 6, borderRadius: 8 },
  spacer: { flex: 1 },
  // Shrinks ahead of the buttons: with the tool row open there is little width
  // left, and a truncated model name beats a wrapped or clipped send button.
  modelChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexShrink: 1,
    paddingHorizontal: 10,
    height: 30,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
  },
  modelChipText: { fontSize: 11, fontFamily: FONT.semibold, flexShrink: 1 },
  roundBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtn: { borderWidth: 0 },
  // lineHeight and the vertical padding deliberately live in the two state
  // styles rather than here, so neither leaks into the other: a collapsed field
  // that inherits lineHeight cannot be centred (see inputCollapsed).
  input: {
    fontSize: 15,
    fontFamily: FONT.regular,
    // 7 rows of text plus vertical padding; beyond that it scrolls inside.
    maxHeight: LINE_HEIGHT * 7 + 16,
    paddingHorizontal: 6,
  },
  // lineHeight is supplied per render, scaled by the reader's text size.
  inputExpanded: {
    minHeight: LINE_HEIGHT + 16,
    paddingTop: 8,
    paddingBottom: 8,
    textAlignVertical: "top",
  },
  // At rest the field is exactly one line tall with the text centred in it, so
  // the closed composer reads as a slim pill rather than an empty text area.
  // The height is fixed because collapsed implies an empty draft - there is
  // never a second line to make room for.
  //
  // Both the line box and its placement are pinned by hand rather than left to
  // the platform. No lineHeight: React Native's Android line-height span pays
  // the extra leading out below the glyphs, so a line box taller than the text
  // hangs the text above centre however the box is aligned. No textAlignVertical
  // either - top alignment plus an explicit padding puts the glyphs at a known
  // offset, where centre alignment would only re-centre whatever box the font
  // reports. What is left is arithmetic: an even split of the slack, supplied
  // per render by collapsedMetrics so it tracks the reader's text size.
  inputCollapsed: {
    paddingBottom: 0,
    textAlignVertical: "top",
    // Android otherwise pads the glyph box out to the font's full ascender and
    // descender, which is what NATURAL_LINE_HEIGHT is measured without.
    includeFontPadding: false,
  },
  attachBarContent: { gap: 8, paddingHorizontal: 4, paddingTop: 8 },
  attachChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 220,
  },
  attachThumb: { width: 30, height: 30, borderRadius: 6 },
  attachInfo: { flexShrink: 1 },
  attachName: { fontSize: 12, fontFamily: FONT.medium },
  attachStatus: { fontSize: 10, fontFamily: FONT.regular, marginTop: 1 },
});
