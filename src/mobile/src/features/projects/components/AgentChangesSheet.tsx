import React, { useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

/** Matches the server cap on a change request. */
const MAX_CHANGES_LENGTH = 4000;

/** The reviewer's changes for an agent's finished run; it continues the same session. */
export function AgentChangesSheet({
  visible,
  agentName,
  pending,
  onClose,
  onSend,
}: {
  visible: boolean;
  agentName: string;
  pending: boolean;
  onClose: () => void;
  onSend: (changes: string) => void;
}) {
  const T = useTheme();
  const [text, setText] = useState("");
  // Render-phase reset, so reopening starts from an empty request.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setText("");
  }
  const trimmed = text.trim();

  return (
    <BottomSheet visible={visible} onClose={onClose} style={styles.sheet}>
      <SheetHeader title={`What should ${agentName} change?`} busy={pending} />
      <Text style={[styles.note, { color: T.textDim }]}>
        It continues the same session, so it remembers what it did.
      </Text>
      <View style={[styles.field, { backgroundColor: T.bg, borderColor: T.border }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Shorten the introduction, add a section on..."
          placeholderTextColor={T.textDim}
          multiline
          autoFocus
          maxLength={MAX_CHANGES_LENGTH}
          style={[styles.input, { color: T.textBright }]}
          accessibilityLabel="Requested changes"
          testID="task-agent-changes-input"
        />
      </View>
      <TouchableOpacity
        style={[styles.cta, { backgroundColor: trimmed ? T.accent : T.surfaceHover }]}
        disabled={!trimmed || pending}
        onPress={() => onSend(trimmed)}
        activeOpacity={0.8}
        accessibilityRole="button"
        testID="task-agent-changes-send"
      >
        <Text style={[styles.ctaText, { color: trimmed ? "#fff" : T.textDim }]}>
          {pending ? "Sending..." : "Send changes"}
        </Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 16 },
  note: { fontSize: 12, fontFamily: FONT.regular, paddingBottom: 10 },
  field: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14 },
  input: {
    minHeight: 96,
    maxHeight: 200,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: FONT.regular,
    textAlignVertical: "top",
  },
  cta: { marginTop: 14, paddingVertical: 13, borderRadius: 12, alignItems: "center" },
  ctaText: { fontSize: 15, fontFamily: FONT.semibold },
});
