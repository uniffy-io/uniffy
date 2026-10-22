import React, { useState } from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { CalendarPicker } from "@features/calendar/components/CalendarPicker";
import { formatMinutes, parseTimeInput } from "@features/projects/timeFormatting";
import { localDayKey } from "@features/projects/timeSerializer";

export interface LogTimeEntry {
  workDate: string;
  durationMinutes: number;
  description: string;
}

export function LogTimeSheet({
  visible,
  onClose,
  taskTitle,
  onSave,
  accentColor,
  saving = false,
  initial,
  defaultDay,
  title,
}: {
  visible: boolean;
  onClose: () => void;
  taskTitle: string;
  onSave: (entry: LogTimeEntry) => void;
  accentColor?: string;
  saving?: boolean;
  /** The entry being edited; absent when logging a new one. */
  initial?: LogTimeEntry;
  /** The day a new entry starts on; today when absent. */
  defaultDay?: string;
  title?: string;
}) {
  const T = useTheme();
  const accent = accentColor || T.accent;
  const [workDate, setWorkDate] = useState<string | null>(localDayKey());
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");

  // Seeded on the way in and not touched again until the sheet closes, so a
  // background refetch never discards what the person is typing.
  const [open, setOpen] = useState(false);
  if (visible && !open) {
    setOpen(true);
    setWorkDate(initial?.workDate ?? defaultDay ?? localDayKey());
    setValue(initial ? formatMinutes(initial.durationMinutes) : "");
    setNote(initial?.description ?? "");
  }
  if (!visible && open) setOpen(false);

  const trimmed = value.trim();
  const parsed = trimmed ? parseTimeInput(trimmed) : null;
  const invalid = trimmed.length > 0 && parsed === null;
  const canSave = Boolean(workDate) && parsed !== null && parsed > 0 && !saving;

  const save = () => {
    if (!canSave || parsed === null || !workDate) return;
    onSave({ workDate, durationMinutes: parsed, description: note.trim() });
  };

  const inputStyle = [
    styles.input,
    { backgroundColor: T.pageBg, borderColor: T.border, color: T.textBright },
  ];

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SheetHeader
        title={title ?? "Log time"}
        accentColor={accent}
        actions={[
          {
            label: saving ? "Saving" : initial ? "Save" : "Log",
            onPress: save,
            disabled: !canSave,
          },
        ]}
      />

      <View style={styles.body}>
        <Text numberOfLines={1} style={[styles.task, { color: T.textDim }]}>
          {taskTitle}
        </Text>

        <Text style={[styles.label, { color: T.textDim }]}>Day</Text>
        <CalendarPicker
          value={workDate}
          onChange={setWorkDate}
          placeholder="Pick a day"
          accentColor={accent}
        />

        <Text style={[styles.label, { color: T.textDim }]}>Duration</Text>
        <TextInput
          style={[inputStyle, invalid && { borderColor: T.red }]}
          value={value}
          onChangeText={setValue}
          placeholder="e.g. 2h 30m"
          placeholderTextColor={T.textDim}
          autoFocus
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={save}
          testID="log-time-duration"
        />
        <Text style={[styles.hint, { color: invalid ? T.red : T.textDim }]}>
          {invalid
            ? "Use a format like 2h, 30m, 2h 30m, or a plain number of minutes."
            : parsed !== null
              ? `Logs ${formatMinutes(parsed)}`
              : "How long you worked on this task that day."}
        </Text>

        <Text style={[styles.label, { color: T.textDim }]}>Note (optional)</Text>
        <TextInput
          style={[inputStyle, styles.note]}
          value={note}
          onChangeText={setNote}
          placeholder="What did you work on?"
          placeholderTextColor={T.textDim}
          multiline
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  task: { fontSize: 13, fontFamily: FONT.regular, marginBottom: 4 },
  label: { fontSize: 12, fontFamily: FONT.medium, marginTop: 4 },
  input: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: FONT.regular,
  },
  note: { minHeight: 72, textAlignVertical: "top" },
  hint: { fontSize: 12, fontFamily: FONT.regular },
});
