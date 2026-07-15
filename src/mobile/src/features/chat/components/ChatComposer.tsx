import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from "react-native";
import { Image } from "expo-image";
import {
  At,
  Check,
  Code,
  PaperPlaneRight,
  Paperclip,
  Plus,
  Smiley,
  TextB,
  X,
} from "phosphor-react-native";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import type { PendingAttachment } from "@features/chat/useComposerAttachments";

export type ComposerTools = {
  onEmoji: () => void;
  onMention: () => void;
  onAttach: () => void;
  onWrap: (marker: string) => void;
};

// Rounded composer card: input on top, action row below. The + button
// holds the formatting tools; the input grows to 7 rows, then scrolls.
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
  attachments = [],
  onRemoveAttachment,
}: {
  T: ThemeColors;
  inputRef?: React.RefObject<TextInput | null>;
  draft: string;
  onChangeDraft: (text: string) => void;
  onSelectionChange?: (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => void;
  placeholder: string;
  canSend: boolean;
  editing?: boolean;
  onSend: () => void;
  tools: ComposerTools;
  attachments?: PendingAttachment[];
  onRemoveAttachment?: (localId: string) => void;
}) {
  const [toolsOpen, setToolsOpen] = useState(false);

  return (
    <View style={[styles.card, { backgroundColor: T.surface, borderColor: T.border }]}>
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
        placeholder={placeholder}
        placeholderTextColor={T.textDim}
        style={[styles.input, { color: T.textBright }]}
        multiline
      />

      <View style={styles.actions}>
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
      </View>
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
    marginHorizontal: 10,
    marginTop: 4,
    marginBottom: 8,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 10,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 4,
  },
  toolRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  toolBtn: { padding: 6, borderRadius: 8 },
  spacer: { flex: 1 },
  roundBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtn: { borderWidth: 0 },
  input: {
    fontSize: 15,
    fontFamily: FONT.regular,
    lineHeight: 21,
    // 7 rows of text plus vertical padding; beyond that it scrolls inside.
    maxHeight: 21 * 7 + 16,
    minHeight: 21 + 16,
    paddingHorizontal: 6,
    paddingTop: 8,
    paddingBottom: 8,
    textAlignVertical: "top",
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
