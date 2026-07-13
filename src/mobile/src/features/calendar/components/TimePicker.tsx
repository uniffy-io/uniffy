import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ScrollView,
  Pressable,
} from "react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

interface TimePickerProps {
  value: string; // "HH:MM" 24-hour
  onChange: (value: string) => void;
  accentColor?: string;
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const PERIODS = ["AM", "PM"] as const;

function parse(value: string): { hour12: number; minute: number; period: "AM" | "PM" } {
  const [h, m] = value.split(":").map((n) => parseInt(n, 10));
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return { hour12, minute: Number.isNaN(m) ? 0 : m, period };
}

function compose(hour12: number, minute: number, period: "AM" | "PM"): string {
  const h24 = period === "PM" ? (hour12 % 12) + 12 : hour12 % 12;
  return `${String(h24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function display(value: string): string {
  const { hour12, minute, period } = parse(value);
  return minute === 0
    ? `${hour12} ${period}`
    : `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

export function TimePicker({ value, onChange, accentColor }: TimePickerProps) {
  const T = useTheme();
  const accent = accentColor ?? T.accent;
  const [open, setOpen] = useState(false);
  const current = parse(value);
  const [hour12, setHour12] = useState(current.hour12);
  const [minute, setMinute] = useState(current.minute);
  const [period, setPeriod] = useState<"AM" | "PM">(current.period);
  const [typed, setTyped] = useState(value);

  const openPicker = () => {
    const c = parse(value);
    setHour12(c.hour12);
    setMinute(c.minute);
    setPeriod(c.period);
    setTyped(value);
    setOpen(true);
  };

  // Wheels and the text field set the same time; keep the typed value in sync
  // so either can drive the result (the field allows any exact minute).
  const setFromWheel = (h12: number, min: number, per: "AM" | "PM") => {
    setHour12(h12);
    setMinute(min);
    setPeriod(per);
    setTyped(compose(h12, min, per));
  };

  const onTypeTime = (text: string) => {
    const digits = text.replace(/\D/g, "").slice(0, 4);
    const formatted = digits.length > 2 ? `${digits.slice(0, -2)}:${digits.slice(-2)}` : digits;
    setTyped(formatted);
    const m = formatted.match(/^(\d{1,2}):(\d{2})$/);
    if (m && parseInt(m[1], 10) <= 23 && parseInt(m[2], 10) <= 59) {
      const h = parseInt(m[1], 10);
      setPeriod(h >= 12 ? "PM" : "AM");
      setHour12(h % 12 || 12);
      setMinute(parseInt(m[2], 10));
    }
  };

  const confirm = () => {
    const m = typed.match(/^(\d{1,2}):(\d{2})$/);
    if (m && parseInt(m[1], 10) <= 23 && parseInt(m[2], 10) <= 59) {
      onChange(`${m[1].padStart(2, "0")}:${m[2]}`);
    } else {
      onChange(compose(hour12, minute, period));
    }
    setOpen(false);
  };

  const Column = ({
    items,
    selected,
    onSelect,
    format,
  }: {
    items: number[];
    selected: number;
    onSelect: (v: number) => void;
    format: (v: number) => string;
  }) => (
    <ScrollView style={styles.column} showsVerticalScrollIndicator={false}>
      {items.map((item) => {
        const isSel = item === selected;
        return (
          <TouchableOpacity
            key={item}
            style={[styles.cell, isSel && { backgroundColor: accent + "22" }]}
            onPress={() => onSelect(item)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.cellText,
                {
                  color: isSel ? accent : T.textBright,
                  fontFamily: isSel ? FONT.bold : FONT.medium,
                },
              ]}
            >
              {format(item)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  return (
    <>
      <TouchableOpacity
        style={[styles.chip, { backgroundColor: T.pageBg }]}
        onPress={openPicker}
        activeOpacity={0.7}
      >
        <Text style={[styles.chipText, { color: T.textBright }]}>{display(value)}</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: T.surface, borderColor: T.border }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.heading, { color: T.textBright }]}>Select time</Text>
            <TextInput
              value={typed}
              onChangeText={onTypeTime}
              keyboardType="number-pad"
              placeholder="HH:MM"
              placeholderTextColor={T.textDim}
              maxLength={5}
              style={[
                styles.typedInput,
                { color: T.textBright, backgroundColor: T.pageBg, borderColor: T.border },
              ]}
            />
            <View style={styles.columns}>
              <Column
                items={HOURS}
                selected={hour12}
                onSelect={(v) => setFromWheel(v, minute, period)}
                format={(v) => String(v)}
              />
              <Column
                items={MINUTES}
                selected={minute}
                onSelect={(v) => setFromWheel(hour12, v, period)}
                format={(v) => String(v).padStart(2, "0")}
              />
              <View style={styles.periodColumn}>
                {PERIODS.map((p) => {
                  const isSel = p === period;
                  return (
                    <TouchableOpacity
                      key={p}
                      style={[styles.cell, isSel && { backgroundColor: accent + "22" }]}
                      onPress={() => setFromWheel(hour12, minute, p)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.cellText,
                          {
                            color: isSel ? accent : T.textBright,
                            fontFamily: isSel ? FONT.bold : FONT.medium,
                          },
                        ]}
                      >
                        {p}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            <TouchableOpacity
              style={[styles.confirmBtn, { backgroundColor: accent }]}
              onPress={confirm}
              activeOpacity={0.85}
            >
              <Text style={styles.confirmText}>Done</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  chipText: { fontSize: 14, fontFamily: FONT.semibold },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  sheet: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    gap: 14,
  },
  heading: { fontSize: 15, fontFamily: FONT.semibold, textAlign: "center" },
  typedInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 20,
    fontFamily: FONT.semibold,
    textAlign: "center",
    letterSpacing: 2,
  },
  columns: { flexDirection: "row", gap: 8, height: 200 },
  column: { flex: 1 },
  periodColumn: { width: 64, gap: 4 },
  cell: {
    paddingVertical: 11,
    borderRadius: 8,
    alignItems: "center",
  },
  cellText: { fontSize: 16 },
  confirmBtn: {
    height: 46,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmText: { fontSize: 15, fontFamily: FONT.semibold, color: "#fff" },
});
