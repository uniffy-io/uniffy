import React, { useCallback, useEffect, useState } from "react";
import { View, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { At, Code, Plus, TextB, TextItalic, X } from "phosphor-react-native";
import { useUniffy } from "@core/providers/UniffyContext";
import { useMentionInput, toCanonical } from "@shared/mentions/useMentionInput";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";

type RichDescriptionInputProps = {
  T: ThemeColors;
  initialContent?: string;
  onCanonicalChange: (canonical: string) => void;
  placeholder?: string;
  accentColor: string;
};

// Chat-composer-style description field: a + button expands @ referencing and
// bold/italic/code formatting, and mentions round-trip through the same
// display <-> [[[label|urn]]] canonical machinery the chat composer uses.
export function RichDescriptionInput({
  T,
  initialContent,
  onCanonicalChange,
  placeholder,
  accentColor,
}: RichDescriptionInputProps) {
  const { openAt } = useUniffy();
  const {
    displayText,
    setDisplayText,
    selection,
    onSelectionChange,
    inputRef,
    mentionsRef,
    initFromCanonical,
  } = useMentionInput(initialContent);
  const [toolsOpen, setToolsOpen] = useState(false);

  useEffect(() => {
    if (initialContent) initFromCanonical(initialContent);
  }, [initialContent, initFromCanonical]);

  // Typing, wrapping, and reference insertion all funnel through setDisplayText,
  // so recomputing here keeps the canonical body in sync for every edit path.
  useEffect(() => {
    onCanonicalChange(toCanonical(displayText, mentionsRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayText]);

  const wrap = useCallback(
    (marker: string) => {
      setDisplayText((prev) => {
        const s = Math.min(selection.start, prev.length);
        const e = Math.min(Math.max(selection.end, selection.start), prev.length);
        return prev.substring(0, s) + marker + prev.substring(s, e) + marker + prev.substring(e);
      });
      setTimeout(() => inputRef.current?.focus(), 30);
    },
    [selection, setDisplayText, inputRef],
  );

  return (
    <View>
      <TextInput
        ref={inputRef}
        value={displayText}
        onChangeText={setDisplayText}
        onSelectionChange={onSelectionChange}
        placeholder={placeholder}
        placeholderTextColor={T.textDim}
        multiline
        textAlignVertical="top"
        style={[styles.input, { color: T.textBright }]}
      />
      <View style={[styles.divider, { backgroundColor: T.border }]} />
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.roundBtn, { backgroundColor: T.bg, borderColor: T.border }]}
          onPress={() => setToolsOpen((v) => !v)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={toolsOpen ? "Hide formatting options" : "Formatting options"}
        >
          {toolsOpen ? (
            <X size={16} color={T.text} weight="bold" />
          ) : (
            <Plus size={16} color={T.text} weight="bold" />
          )}
        </TouchableOpacity>
        {toolsOpen ? (
          <View style={styles.toolRow}>
            <ToolButton onPress={() => openAt(true)}>
              <At size={18} color={accentColor} weight="bold" />
            </ToolButton>
            <ToolButton onPress={() => wrap("**")}>
              <TextB size={17} color={T.textDim} weight="bold" />
            </ToolButton>
            <ToolButton onPress={() => wrap("*")}>
              <TextItalic size={17} color={T.textDim} weight="bold" />
            </ToolButton>
            <ToolButton onPress={() => wrap("`")}>
              <Code size={17} color={T.textDim} weight="bold" />
            </ToolButton>
          </View>
        ) : null}
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
  input: {
    fontSize: 14,
    fontFamily: FONT.regular,
    lineHeight: 20,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    // Grows with content up to 7 rows, then scrolls inside (matches the chat
    // composer). The scroll indicator stays hidden on this short field.
    minHeight: 20 * 3 + 24,
    maxHeight: 20 * 7 + 24,
    textAlignVertical: "top",
  },
  divider: { height: StyleSheet.hairlineWidth },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  toolRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  toolBtn: { padding: 6, borderRadius: 8 },
  roundBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
});
