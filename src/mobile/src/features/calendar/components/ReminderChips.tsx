import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

export const REMINDER_OPTIONS = [
  { value: 15, label: "15 min before" },
  { value: 30, label: "30 min before" },
  { value: 60, label: "1 hour before" },
  { value: 1440, label: "1 day before" },
] as const;

export function reminderLabel(minutes: number): string {
  const known = REMINDER_OPTIONS.find((o) => o.value === minutes);
  if (known) return known.label;
  if (minutes % 1440 === 0) return `${minutes / 1440} days before`;
  if (minutes % 60 === 0) return `${minutes / 60} hours before`;
  return `${minutes} min before`;
}

export function ReminderChips({
  value,
  onChange,
  lockLast = false,
}: {
  value: number[];
  onChange: (reminders: number[]) => void;
  /** Editing an existing event: the wire cannot clear every reminder, so the last one stays. */
  lockLast?: boolean;
}) {
  const T = useTheme();

  const toggle = (minutes: number) => {
    if (value.includes(minutes)) {
      if (lockLast && value.length === 1) return;
      onChange(value.filter((v) => v !== minutes));
    } else {
      onChange([...value, minutes].sort((a, b) => a - b));
    }
  };

  return (
    <View style={styles.row}>
      {REMINDER_OPTIONS.map((option) => {
        const active = value.includes(option.value);
        return (
          <TouchableOpacity
            key={option.value}
            style={[
              styles.chip,
              {
                borderColor: active ? T.accent : T.border,
                backgroundColor: active ? T.accent + "18" : "transparent",
              },
            ]}
            onPress={() => toggle(option.value)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Reminder ${option.label}: ${active ? "on" : "off"}`}
          >
            <Text style={[styles.chipText, { color: active ? T.accent : T.textDim }]}>
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9, borderWidth: 1 },
  chipText: { fontSize: 13, fontFamily: FONT.medium },
});
