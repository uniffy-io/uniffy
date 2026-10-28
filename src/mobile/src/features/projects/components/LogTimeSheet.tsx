import React, { useRef, useState } from "react";
import { View, Text, TextInput, ScrollView, StyleSheet, TouchableOpacity } from "react-native";
import { X } from "phosphor-react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { useTheme } from "@shared/hooks/useTheme";
import { instantFromZonedWall, zonedParts } from "@shared/lib/zonedTime";
import { FONT } from "@theme/typography";
import { CalendarPicker } from "@features/calendar/components/CalendarPicker";
import { TimePicker } from "@features/calendar/components/TimePicker";
import { endOf, entryProblem, minutesOfDay, wallOf } from "@features/projects/timeClock";
import { formatMinutes, parseTimeInput } from "@features/projects/timeFormatting";
import { localDayKey } from "@features/projects/timeSerializer";

export interface LogTimeEntry {
  workDate: string;
  durationMinutes: number;
  description: string;
  /** ISO instant the work began; null keeps the entry off the clock. */
  startedAt: string | null;
}

const DEFAULT_START = "09:00";
const DEFAULT_MINUTES = 60;
// The keyboard lifts the sheet over a few frames; scrolling before it settles lands short.
const KEYBOARD_SETTLE_MS = 250;

function wallOfInstant(iso: string): string {
  const parts = zonedParts(new Date(iso));
  return wallOf(parts.hour * 60 + parts.minute);
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
  const scroll = useRef<ScrollView>(null);
  const [workDate, setWorkDate] = useState<string | null>(localDayKey());
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [start, setStart] = useState<string | null>(null);

  // Seeded on the way in and not touched again until the sheet closes, so a
  // background refetch never discards what the person is typing.
  const [open, setOpen] = useState(false);
  if (visible && !open) {
    setOpen(true);
    setWorkDate(initial?.workDate ?? defaultDay ?? localDayKey());
    setValue(initial ? formatMinutes(initial.durationMinutes) : "");
    setNote(initial?.description ?? "");
    setStart(initial?.startedAt ? wallOfInstant(initial.startedAt) : null);
  }
  if (!visible && open) setOpen(false);

  const trimmed = value.trim();
  const parsed = trimmed ? parseTimeInput(trimmed) : null;
  const invalid = trimmed.length > 0 && parsed === null;
  const problem = entryProblem(parsed, start);
  const canSave = Boolean(workDate) && parsed !== null && parsed > 0 && problem === null && !saving;
  const end = start ? endOf(start, parsed ?? 0) : null;

  const save = () => {
    if (!canSave || parsed === null || !workDate) return;
    onSave({
      workDate,
      durationMinutes: parsed,
      description: note.trim(),
      startedAt: start ? instantFromZonedWall(workDate, start).toISOString() : null,
    });
  };

  const addTimes = () => {
    setStart(DEFAULT_START);
    if (parsed === null) setValue(formatMinutes(DEFAULT_MINUTES));
  };

  // An end sets the length; one at or before the start is not a range.
  const pickEnd = (wall: string) => {
    if (!start) return;
    const minutes = minutesOfDay(wall) - minutesOfDay(start);
    if (minutes > 0) setValue(formatMinutes(minutes));
  };

  const inputStyle = [
    styles.input,
    { backgroundColor: T.pageBg, borderColor: T.border, color: T.textBright },
  ];

  const hint = invalid
    ? "Use a format like 2h, 30m, 2h 30m, or a plain number of minutes."
    : problem
      ? problem
      : parsed !== null
        ? `Logs ${formatMinutes(parsed)}`
        : "How long you worked on this task that day.";

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

      <ScrollView
        ref={scroll}
        style={styles.scroll}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
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
          style={[inputStyle, (invalid || problem) && { borderColor: T.red }]}
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
        <Text
          style={[styles.hint, { color: invalid || problem ? T.red : T.textDim }]}
          testID={problem ? "log-time-problem" : undefined}
        >
          {hint}
        </Text>

        {start && end ? (
          <View style={styles.clockRow} testID="log-time-clock">
            <View style={styles.clockField}>
              <Text style={[styles.label, { color: T.textDim }]}>Start</Text>
              <TimePicker value={start} onChange={setStart} accentColor={accent} />
            </View>
            <View style={styles.clockField}>
              <Text style={[styles.label, { color: T.textDim }]}>End</Text>
              <TimePicker value={end} onChange={pickEnd} accentColor={accent} />
            </View>
            <TouchableOpacity
              onPress={() => setStart(null)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Remove start and end"
              testID="log-time-clear-clock"
              style={styles.clear}
            >
              <X size={16} color={T.textDim} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity onPress={addTimes} testID="log-time-add-clock">
            <Text style={[styles.link, { color: accent }]}>Add start and end time</Text>
          </TouchableOpacity>
        )}

        <Text style={[styles.label, { color: T.textDim }]}>Note (optional)</Text>
        <TextInput
          style={[inputStyle, styles.note]}
          value={note}
          onChangeText={setNote}
          onFocus={() =>
            setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), KEYBOARD_SETTLE_MS)
          }
          placeholder="What did you work on?"
          placeholderTextColor={T.textDim}
          multiline
          testID="log-time-note"
        />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  // Shrinks with the sheet's keyboard-lowered cap so the fields scroll instead of clipping.
  scroll: { flexShrink: 1 },
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
  link: { fontSize: 13, fontFamily: FONT.semibold, paddingVertical: 4 },
  clockRow: { flexDirection: "row", alignItems: "flex-end", gap: 12 },
  clockField: { gap: 4 },
  clear: { paddingBottom: 10 },
});
