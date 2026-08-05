import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
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

  // Reset to the current value each time the sheet opens rather than holding a
  // stale draft from a previous task.
  const [openedFor, setOpenedFor] = useState<number | undefined>(undefined);
  if (visible && openedFor !== minutes) {
    setOpenedFor(minutes);
    setValue(minutes ? formatMinutes(minutes) : "");
  }

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
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: T.textBright }]}>{title}</Text>
        <TouchableOpacity
          onPress={save}
          disabled={invalid}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.save, { color: invalid ? T.textDim : accent }]}>Save</Text>
        </TouchableOpacity>
      </View>

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
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  title: { fontSize: 16, fontFamily: FONT.bold },
  save: { fontSize: 15, fontFamily: FONT.semibold },
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
