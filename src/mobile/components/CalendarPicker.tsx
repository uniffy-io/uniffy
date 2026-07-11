import React, { useState, useMemo } from "react";
import { View, Text, TouchableOpacity, Modal, StyleSheet, Pressable } from "react-native";
import { CaretLeft, CaretRight, CalendarBlank } from "phosphor-react-native";
import { useTheme } from "@/hooks/useTheme";
import { FONT } from "@/constants/typography";

interface CalendarPickerProps {
  value: string | null;
  onChange: (date: string | null) => void;
  placeholder?: string;
  accentColor?: string;
}

interface DayCell {
  day: number;
  date: Date;
  isCurrentMonth: boolean;
}

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function buildMonthCells(year: number, month: number): DayCell[] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const leadingBlanks = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
  const cells: DayCell[] = [];

  const prevMonthDays = new Date(year, month, 0).getDate();
  for (let i = leadingBlanks - 1; i >= 0; i--) {
    const day = prevMonthDays - i;
    cells.push({ day, date: new Date(year, month - 1, day), isCurrentMonth: false });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, date: new Date(year, month, d), isCurrentMonth: true });
  }

  while (cells.length % 7 !== 0) {
    const day = cells.length - leadingBlanks - daysInMonth + 1;
    cells.push({ day, date: new Date(year, month + 1, day), isCurrentMonth: false });
  }

  return cells;
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDisplay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function CalendarPicker({
  value,
  onChange,
  placeholder = "Select date",
  accentColor = "#694aff",
}: CalendarPickerProps) {
  const T = useTheme();
  const [visible, setVisible] = useState(false);

  const initialDate = value ? new Date(value + "T00:00:00") : new Date();
  const [viewYear, setViewYear] = useState(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialDate.getMonth());

  const todayKey = formatDateKey(new Date());
  const selectedKey = value ?? "";

  const cells = useMemo(() => buildMonthCells(viewYear, viewMonth), [viewYear, viewMonth]);

  function goToPrevMonth() {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function goToNextMonth() {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  function selectDate(cell: DayCell) {
    const key = formatDateKey(cell.date);
    onChange(key);
    setVisible(false);
  }

  function goToToday() {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    onChange(formatDateKey(now));
    setVisible(false);
  }

  function clearDate() {
    onChange(null);
    setVisible(false);
  }

  function openPicker() {
    if (value) {
      const d = new Date(value + "T00:00:00");
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
    } else {
      const now = new Date();
      setViewYear(now.getFullYear());
      setViewMonth(now.getMonth());
    }
    setVisible(true);
  }

  return (
    <>
      <TouchableOpacity
        style={[styles.trigger, { backgroundColor: T.surface, borderColor: T.border }]}
        onPress={openPicker}
        activeOpacity={0.7}
      >
        <CalendarBlank size={16} color={value ? accentColor : T.textDim} weight="duotone" />
        <Text style={[styles.triggerText, { color: value ? T.textBright : T.textDim }]}>
          {value ? formatDisplay(value) : placeholder}
        </Text>
      </TouchableOpacity>

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => setVisible(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setVisible(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: T.bg }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.header}>
              <TouchableOpacity
                onPress={goToPrevMonth}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <CaretLeft size={20} color={T.text} weight="bold" />
              </TouchableOpacity>
              <Text style={[styles.headerTitle, { color: T.textBright }]}>
                {MONTHS[viewMonth]} {viewYear}
              </Text>
              <TouchableOpacity
                onPress={goToNextMonth}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <CaretRight size={20} color={T.text} weight="bold" />
              </TouchableOpacity>
            </View>

            <View style={styles.weekRow}>
              {WEEKDAYS.map((day) => (
                <View key={day} style={styles.weekCell}>
                  <Text style={[styles.weekLabel, { color: T.textDim }]}>{day}</Text>
                </View>
              ))}
            </View>

            <View style={styles.grid}>
              {cells.map((cell, i) => {
                const key = formatDateKey(cell.date);
                const isToday = key === todayKey;
                const isSelected = key === selectedKey;
                return (
                  <TouchableOpacity
                    key={i}
                    style={styles.dayCell}
                    onPress={() => selectDate(cell)}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        styles.dayCircle,
                        isSelected && { backgroundColor: accentColor },
                        isToday && !isSelected && { borderColor: accentColor, borderWidth: 1 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.dayText,
                          { color: cell.isCurrentMonth ? T.textBright : T.textDim },
                          isSelected && { color: "#fff" },
                          isToday && !isSelected && { color: accentColor },
                        ]}
                      >
                        {cell.day}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.footer}>
              <TouchableOpacity
                style={[styles.footerBtn, { backgroundColor: T.surface }]}
                onPress={goToToday}
                activeOpacity={0.7}
              >
                <Text style={[styles.footerBtnText, { color: accentColor }]}>Today</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.footerBtn, { backgroundColor: T.surface }]}
                onPress={clearDate}
                activeOpacity={0.7}
              >
                <Text style={[styles.footerBtnText, { color: T.textDim }]}>Clear</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  triggerText: {
    fontSize: 14,
    fontFamily: FONT.regular,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  sheet: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 16,
    padding: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: FONT.semibold,
  },
  weekRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  weekCell: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 4,
  },
  weekLabel: {
    fontSize: 12,
    fontFamily: FONT.medium,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  dayCell: {
    width: "14.28%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dayCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  dayText: {
    fontSize: 14,
    fontFamily: FONT.regular,
  },
  footer: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  footerBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 10,
  },
  footerBtnText: {
    fontSize: 14,
    fontFamily: FONT.medium,
  },
});
