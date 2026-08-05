import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

export const STATUS_COLORS = [
  "#6b7280",
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#14b8a6",
];

/** Creates a status when `initialLabel` is empty, edits one otherwise. */
export function StatusEditorSheet({
  visible,
  onClose,
  title,
  initialLabel,
  initialColor,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  initialLabel: string;
  initialColor: string;
  onSave: (label: string, color: string) => void;
}) {
  const T = useTheme();
  const [label, setLabel] = useState(initialLabel);
  const [color, setColor] = useState(initialColor);

  // Reseed whenever the sheet reopens against a different status, so an edit
  // never starts from the previous row's draft.
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const openKey = `${title}:${initialLabel}:${initialColor}`;
  if (visible && openedFor !== openKey) {
    setOpenedFor(openKey);
    setLabel(initialLabel);
    setColor(initialColor);
  }

  const trimmed = label.trim();

  const save = () => {
    if (!trimmed) return;
    onSave(trimmed, color);
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: T.textBright }]}>{title}</Text>
        <TouchableOpacity
          onPress={save}
          disabled={!trimmed}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.save, { color: trimmed ? T.accent : T.textDim }]}>Save</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        <TextInput
          style={[
            styles.input,
            { backgroundColor: T.pageBg, borderColor: T.border, color: T.textBright },
          ]}
          value={label}
          onChangeText={setLabel}
          placeholder="Status name"
          placeholderTextColor={T.textDim}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={save}
        />

        <View style={styles.colorRow}>
          {STATUS_COLORS.map((c) => (
            <TouchableOpacity
              key={c}
              style={[
                styles.colorDot,
                { backgroundColor: c },
                color === c && { borderWidth: 3, borderColor: T.textBright },
              ]}
              onPress={() => setColor(c)}
              activeOpacity={0.7}
            />
          ))}
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  title: { fontSize: 16, fontFamily: FONT.bold },
  save: { fontSize: 15, fontFamily: FONT.semibold },
  body: { paddingHorizontal: 16, paddingBottom: 16, gap: 14 },
  input: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: FONT.regular,
  },
  colorRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  colorDot: { width: 32, height: 32, borderRadius: 16 },
});
