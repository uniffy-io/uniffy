import React, { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { Minus, Plus } from "phosphor-react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { SheetRow } from "@shared/components/SheetRow";
import { CalendarPicker } from "@features/calendar/components/CalendarPicker";
import { useTheme } from "@shared/hooks/useTheme";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import type { SerializedRecurrence } from "@features/calendar/calendarSerializer";

const PATTERNS: { value: string; label: string }[] = [
  { value: "NONE", label: "Does not repeat" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "BIWEEKLY", label: "Every 2 weeks" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "YEARLY", label: "Yearly" },
];

const DAYS: { value: string; label: string }[] = [
  { value: "monday", label: "M" },
  { value: "tuesday", label: "T" },
  { value: "wednesday", label: "W" },
  { value: "thursday", label: "T" },
  { value: "friday", label: "F" },
  { value: "saturday", label: "S" },
  { value: "sunday", label: "S" },
];

const INTERVAL_UNIT: Record<string, string> = {
  DAILY: "day",
  WEEKLY: "week",
  MONTHLY: "month",
  YEARLY: "year",
};

type EndCondition = "never" | "after" | "on_date";

function todayDayName(): string {
  const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return names[new Date().getDay()];
}

function Stepper({
  value,
  min,
  max,
  onChange,
  T,
  accent,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  T: ThemeColors;
  accent: string;
}) {
  return (
    <View style={[styles.stepper, { borderColor: T.border }]}>
      <TouchableOpacity
        onPress={() => onChange(Math.max(min, value - 1))}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel="Decrease"
      >
        <Minus size={14} color={T.textDim} weight="bold" />
      </TouchableOpacity>
      <Text style={[styles.stepperValue, { color: T.textBright }]}>{value}</Text>
      <TouchableOpacity
        onPress={() => onChange(Math.min(max, value + 1))}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel="Increase"
      >
        <Plus size={14} color={accent} weight="bold" />
      </TouchableOpacity>
    </View>
  );
}

export function RecurrenceSheet({
  visible,
  onClose,
  value,
  onChange,
  accentColor,
}: {
  visible: boolean;
  onClose: () => void;
  value: SerializedRecurrence | undefined;
  onChange: (next: SerializedRecurrence | undefined) => void;
  accentColor?: string;
}) {
  const T = useTheme();
  const accent = accentColor || T.accent;
  const pattern = value?.pattern ?? "NONE";

  const [endCondition, setEndCondition] = useState<EndCondition>("never");
  // Re-derive the end condition each time the sheet opens: "After 10 times"
  // and "no end" both leave endDate empty, so the choice cannot be read back
  // from the rule alone once the user is mid-edit.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setEndCondition(value?.maxOccurrences ? "after" : value?.endDate ? "on_date" : "never");
    }
  }

  const patch = (partial: Partial<SerializedRecurrence>) => {
    if (!value) return;
    onChange({ ...value, ...partial });
  };

  const pickPattern = (next: string) => {
    if (next === "NONE") {
      onChange(undefined);
      setEndCondition("never");
      return;
    }
    onChange({
      pattern: next,
      interval: next === "BIWEEKLY" ? 2 : (value?.interval ?? 1),
      daysOfWeek:
        next === "DAILY"
          ? DAYS.map((d) => d.value)
          : next === "WEEKLY" || next === "BIWEEKLY"
            ? value?.daysOfWeek?.length
              ? value.daysOfWeek
              : [todayDayName()]
            : [],
      dayOfMonth: next === "MONTHLY" ? (value?.dayOfMonth ?? 1) : undefined,
      endDate: endCondition === "on_date" ? value?.endDate : undefined,
      maxOccurrences: endCondition === "after" ? value?.maxOccurrences : undefined,
    });
  };

  const toggleDay = (day: string) => {
    if (!value) return;
    const current = value.daysOfWeek;
    patch({
      daysOfWeek: current.includes(day) ? current.filter((d) => d !== day) : [...current, day],
    });
  };

  const pickEndCondition = (condition: EndCondition) => {
    setEndCondition(condition);
    if (condition === "never") patch({ endDate: undefined, maxOccurrences: undefined });
    if (condition === "after") {
      patch({ maxOccurrences: value?.maxOccurrences ?? 10, endDate: undefined });
    }
    if (condition === "on_date") patch({ maxOccurrences: undefined });
  };

  const showDayToggles = pattern === "DAILY" || pattern === "WEEKLY" || pattern === "BIWEEKLY";
  const endDateKey = value?.endDate ? value.endDate.slice(0, 10) : null;

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SheetHeader
        title="Repeat"
        accentColor={accent}
        actions={[{ label: "Done", onPress: onClose }]}
      />
      <ScrollView style={{ maxHeight: 440 }} keyboardShouldPersistTaps="handled">
        {PATTERNS.map((option) => (
          <SheetRow
            key={option.value}
            title={option.label}
            muted={option.value === "NONE"}
            selected={pattern === option.value}
            accentColor={accent}
            onPress={() => pickPattern(option.value)}
          />
        ))}

        {value && (
          <View style={styles.details}>
            {INTERVAL_UNIT[pattern] ? (
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: T.textDim }]}>Every</Text>
                <Stepper
                  value={value.interval}
                  min={1}
                  max={99}
                  onChange={(interval) => patch({ interval })}
                  T={T}
                  accent={accent}
                />
                <Text style={[styles.detailLabel, { color: T.textDim }]}>
                  {INTERVAL_UNIT[pattern]}
                  {value.interval === 1 ? "" : "s"}
                </Text>
              </View>
            ) : null}

            {showDayToggles && (
              <View style={styles.dayRow}>
                {DAYS.map((day) => {
                  const active = value.daysOfWeek.includes(day.value);
                  return (
                    <TouchableOpacity
                      key={day.value}
                      style={[
                        styles.dayToggle,
                        {
                          borderColor: active ? accent : T.border,
                          backgroundColor: active ? accent + "18" : "transparent",
                        },
                      ]}
                      onPress={() => toggleDay(day.value)}
                      activeOpacity={0.7}
                      accessibilityLabel={`Repeat on ${day.value}: ${active ? "on" : "off"}`}
                    >
                      <Text style={[styles.dayToggleText, { color: active ? accent : T.textDim }]}>
                        {day.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {pattern === "MONTHLY" && (
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: T.textDim }]}>On day</Text>
                <Stepper
                  value={value.dayOfMonth ?? 1}
                  min={1}
                  max={31}
                  onChange={(dayOfMonth) => patch({ dayOfMonth })}
                  T={T}
                  accent={accent}
                />
                <Text style={[styles.detailLabel, { color: T.textDim }]}>of the month</Text>
              </View>
            )}

            <Text style={[styles.endsLabel, { color: T.textDim }]}>ENDS</Text>
            <SheetRow
              title="Never"
              selected={endCondition === "never"}
              accentColor={accent}
              onPress={() => pickEndCondition("never")}
            />
            <SheetRow
              title="After a number of times"
              selected={endCondition === "after"}
              trailing={
                endCondition === "after" ? (
                  <Stepper
                    value={value.maxOccurrences ?? 10}
                    min={1}
                    max={999}
                    onChange={(maxOccurrences) => patch({ maxOccurrences })}
                    T={T}
                    accent={accent}
                  />
                ) : undefined
              }
              accentColor={accent}
              onPress={() => pickEndCondition("after")}
            />
            <SheetRow
              title="On a date"
              selected={endCondition === "on_date"}
              accentColor={accent}
              onPress={() => pickEndCondition("on_date")}
            />
            {endCondition === "on_date" && (
              <View style={styles.endDateWrap}>
                <CalendarPicker
                  value={endDateKey}
                  onChange={(dateKey) =>
                    // End of the picked day, so the final occurrence still runs.
                    patch({
                      endDate: dateKey ? new Date(`${dateKey}T23:59:59`).toISOString() : undefined,
                    })
                  }
                  placeholder="Pick end date"
                  accentColor={accent}
                />
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  details: { paddingBottom: 8 },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  detailLabel: { fontSize: 13, fontFamily: FONT.regular },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9,
    borderWidth: 1,
  },
  stepperValue: {
    fontSize: 14,
    fontFamily: FONT.semibold,
    minWidth: 22,
    textAlign: "center",
  },
  dayRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  dayToggle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dayToggleText: { fontSize: 13, fontFamily: FONT.semibold },
  endsLabel: {
    fontSize: 11,
    fontFamily: FONT.semibold,
    letterSpacing: 0.8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  endDateWrap: { paddingHorizontal: 16, paddingVertical: 10 },
});
