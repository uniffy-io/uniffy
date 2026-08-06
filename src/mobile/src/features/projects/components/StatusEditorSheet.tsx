import React, { useState } from "react";
import { View, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { STATUS_PALETTE } from "@theme/theme";

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

  // Seeded on the way in and not touched again until the sheet closes, so an
  // edit starts from the row it was opened on and nothing later overwrites it.
  const [open, setOpen] = useState(false);
  if (visible && !open) {
    setOpen(true);
    setLabel(initialLabel);
    setColor(initialColor);
  }
  if (!visible && open) setOpen(false);

  const trimmed = label.trim();

  const save = () => {
    if (!trimmed) return;
    onSave(trimmed, color);
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SheetHeader title={title} actions={[{ label: "Save", onPress: save, disabled: !trimmed }]} />

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
          {STATUS_PALETTE.map((c) => (
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
