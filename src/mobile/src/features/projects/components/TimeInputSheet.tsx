import React, { useState } from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { formatMinutes, parseTimeInput } from "@features/projects/timeFormatting";

export function TimeInputSheet({
  visible,
  onClose,
  title,
  minutes,
  onSave,
  accentColor,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  minutes: number | undefined;
  onSave: (minutes: number | null) => void;
  accentColor?: string;
}) {
  const T = useTheme();
  const accent = accentColor || T.accent;
  const [value, setValue] = useState("");

  // Seeded on the way in and not touched again until the sheet closes: keying
  // the reseed off `minutes` would let a background refetch of the task discard
  // what the user is typing.
  const [open, setOpen] = useState(false);
  if (visible && !open) {
    setOpen(true);
    setValue(minutes ? formatMinutes(minutes) : "");
  }
  if (!visible && open) setOpen(false);

  const trimmed = value.trim();
  const parsed = trimmed ? parseTimeInput(trimmed) : null;
  const invalid = trimmed.length > 0 && parsed === null;

  const save = () => {
    if (invalid) return;
    onSave(trimmed ? parsed : null);
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SheetHeader
        title={title}
        accentColor={accent}
        actions={[{ label: "Save", onPress: save, disabled: invalid }]}
      />

      <View style={styles.body}>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: T.pageBg,
              borderColor: invalid ? T.red : T.border,
              color: T.textBright,
            },
          ]}
          value={value}
          onChangeText={setValue}
          placeholder="e.g. 2h 30m"
          placeholderTextColor={T.textDim}
          autoFocus
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={save}
        />
        <Text style={[styles.hint, { color: invalid ? T.red : T.textDim }]}>
          {invalid
            ? "Use a format like 2h, 30m, 2h 30m, or a plain number of minutes."
            : parsed !== null
              ? `Saves as ${formatMinutes(parsed)}`
              : "Leave empty to clear."}
        </Text>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  input: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: FONT.regular,
  },
  hint: { fontSize: 12, fontFamily: FONT.regular },
});
