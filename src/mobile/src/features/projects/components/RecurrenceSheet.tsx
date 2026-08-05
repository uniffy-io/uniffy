import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { Check } from "phosphor-react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import {
  RECURRENCE_PATTERNS,
  DAYS_OF_WEEK,
  describeRecurrence,
  defaultRecurrence,
  parseRecurrence,
  serializeRecurrence,
} from "@features/projects/taskRecurrence";
import type { RecurrenceConfig, RecurrencePattern } from "@features/projects/taskRecurrence";

export function RecurrenceSheet({
  visible,
  onClose,
  rule,
  onSave,
  accentColor,
}: {
  visible: boolean;
  onClose: () => void;
  rule: string | undefined;
  onSave: (rule: string | null) => void;
  accentColor?: string;
}) {
  const T = useTheme();
  const accent = accentColor || T.accent;
  const [config, setConfig] = useState<RecurrenceConfig>(
    () => parseRecurrence(rule) ?? defaultRecurrence(),
  );

  // Reseed from the task each time the sheet opens rather than keeping the
  // draft from whichever task was edited last.
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (visible && openedFor !== (rule ?? "")) {
    setOpenedFor(rule ?? "");
    setConfig(parseRecurrence(rule) ?? defaultRecurrence());
  }

  const weekly = config.pattern === "weekly" || config.pattern === "biweekly";

  const toggleDay = (day: string) => {
    const current = config.days_of_week ?? [];
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
    setConfig({ ...config, days_of_week: next.length > 0 ? next : undefined });
  };

  const setInterval = (text: string) => {
    const parsed = parseInt(text.replace(/[^0-9]/g, ""), 10);
    setConfig({ ...config, interval: Number.isNaN(parsed) ? 1 : Math.max(1, parsed) });
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: T.textBright }]}>Repeat</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => {
              onSave(null);
              onClose();
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.clear, { color: T.textDim }]}>Don&apos;t repeat</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              onSave(serializeRecurrence(config));
              onClose();
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.save, { color: accent }]}>Save</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={{ maxHeight: 440 }} keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: T.textDim }]}>Pattern</Text>
          <View style={styles.chipWrap}>
            {RECURRENCE_PATTERNS.map((option) => {
              const selected = config.pattern === option.value;
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selected ? accent + "22" : T.pageBg,
                      borderColor: selected ? accent : T.border,
                    },
                  ]}
                  onPress={() =>
                    setConfig({ ...config, pattern: option.value as RecurrencePattern })
                  }
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipText, { color: selected ? accent : T.text }]}>
                    {option.label}
                  </Text>
                  {selected && <Check size={12} color={accent} weight="bold" />}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {config.pattern !== "biweekly" && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: T.textDim }]}>Every</Text>
            <View style={styles.intervalRow}>
              <TextInput
                style={[
                  styles.intervalInput,
                  { backgroundColor: T.pageBg, borderColor: T.border, color: T.textBright },
                ]}
                value={`${config.interval}`}
                onChangeText={setInterval}
                keyboardType="number-pad"
                returnKeyType="done"
              />
              <Text style={[styles.intervalUnit, { color: T.textDim }]}>
                {config.pattern === "daily"
                  ? "day(s)"
                  : config.pattern === "weekly"
                    ? "week(s)"
                    : config.pattern === "monthly"
                      ? "month(s)"
                      : "year(s)"}
              </Text>
            </View>
          </View>
        )}

        {weekly && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: T.textDim }]}>On days</Text>
            <View style={styles.chipWrap}>
              {DAYS_OF_WEEK.map((day) => {
                const selected = (config.days_of_week ?? []).includes(day.value);
                return (
                  <TouchableOpacity
                    key={day.value}
                    style={[
                      styles.dayChip,
                      {
                        backgroundColor: selected ? accent : T.pageBg,
                        borderColor: selected ? accent : T.border,
                      },
                    ]}
                    onPress={() => toggleDay(day.value)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.dayText, { color: selected ? "#fff" : T.text }]}>
                      {day.short}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: T.textDim }]}>Ends</Text>
          <View style={styles.endRow}>
            <Text style={[styles.endLabel, { color: T.text }]}>After</Text>
            <TextInput
              style={[
                styles.intervalInput,
                { backgroundColor: T.pageBg, borderColor: T.border, color: T.textBright },
              ]}
              value={config.max_occurrences ? `${config.max_occurrences}` : ""}
              onChangeText={(text) => {
                const parsed = parseInt(text.replace(/[^0-9]/g, ""), 10);
                setConfig({
                  ...config,
                  max_occurrences: Number.isNaN(parsed) || parsed < 1 ? null : parsed,
                });
              }}
              placeholder="never"
              placeholderTextColor={T.textDim}
              keyboardType="number-pad"
              returnKeyType="done"
            />
            <Text style={[styles.endLabel, { color: T.textDim }]}>times</Text>
          </View>
        </View>

        <Text style={[styles.summary, { color: accent }]}>{describeRecurrence(config)}</Text>
      </ScrollView>
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
  headerActions: { flexDirection: "row", alignItems: "center", gap: 16 },
  title: { fontSize: 16, fontFamily: FONT.bold },
  clear: { fontSize: 14, fontFamily: FONT.regular },
  save: { fontSize: 15, fontFamily: FONT.semibold },
  section: { paddingHorizontal: 16, paddingBottom: 14, gap: 8 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: FONT.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontSize: 13, fontFamily: FONT.medium },
  dayChip: {
    width: 40,
    paddingVertical: 8,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  dayText: { fontSize: 13, fontFamily: FONT.medium },
  intervalRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  intervalInput: {
    width: 72,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
    fontFamily: FONT.regular,
    textAlign: "center",
  },
  intervalUnit: { fontSize: 14, fontFamily: FONT.regular },
  endRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  endLabel: { fontSize: 14, fontFamily: FONT.regular },
  summary: {
    fontSize: 13,
    fontFamily: FONT.medium,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
});
