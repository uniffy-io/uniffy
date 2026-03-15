import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { Plus, CaretLeft, CaretRight } from "phosphor-react-native";
import { router } from "expo-router";
import { DomainHeader } from "@/components/DomainHeader";
import { useTheme } from "@/hooks/useTheme";
import { DOMAIN_COLORS } from "@/constants/theme";
import { useEventsInRange, useCategories } from "@/hooks/useCalendar";
import type { SerializedEvent, SerializedCategory } from "@/lib/calendarSerializer";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type ViewMode = "day" | "month";

// Hour grid config
const HOUR_START = 0; // midnight
const HOUR_END = 24;
const HOUR_HEIGHT = 60; // px per hour
const GRID_HEIGHT = (HOUR_END - HOUR_START) * HOUR_HEIGHT;
const TIME_COL_WIDTH = 56;

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getMonthLabel(date: Date): string {
  const months = [
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
  return `${months[date.getMonth()]} ${date.getFullYear()}`;
}

function formatHourLabel(hour: number): string {
  if (hour === 0 || hour === 24) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

function getMinutesSinceMidnight(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

function getEventColor(
  event: SerializedEvent,
  categoriesMap: Map<string, SerializedCategory>,
): string {
  if (event.categoryId) {
    const cat = categoriesMap.get(event.categoryId);
    if (cat?.color) return cat.color;
  }
  return DOMAIN_COLORS.calendar;
}

const MAX_EVENTS_PER_CELL = 3;

type MonthCell = {
  day: number | null;
  date: Date | null;
  isCurrentMonth: boolean;
};

function buildMonthCells(currentMonth: Date): MonthCell[] {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const leadingBlanks = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;

  const cells: MonthCell[] = [];

  // Previous month trailing days
  const prevMonthDays = new Date(year, month, 0).getDate();
  for (let i = leadingBlanks - 1; i >= 0; i--) {
    const day = prevMonthDays - i;
    cells.push({ day, date: new Date(year, month - 1, day), isCurrentMonth: false });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, date: new Date(year, month, d), isCurrentMonth: true });
  }

  // Next month leading days
  while (cells.length % 7 !== 0) {
    const day = cells.length - leadingBlanks - daysInMonth + 1;
    cells.push({ day, date: new Date(year, month + 1, day), isCurrentMonth: false });
  }

  return cells;
}

function MonthGrid({
  T,
  currentMonth,
  selectedDate,
  onSelectDate,
  events,
  categoriesMap,
}: {
  T: ReturnType<typeof useTheme>;
  currentMonth: Date;
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  events: SerializedEvent[];
  categoriesMap: Map<string, SerializedCategory>;
}) {
  const today = new Date();
  const cells = useMemo(() => buildMonthCells(currentMonth), [currentMonth]);

  // Group events by date key "YYYY-MM-DD"
  const eventsByDate = useMemo(() => {
    const map = new Map<string, SerializedEvent[]>();
    events.forEach((e) => {
      if (!e.startTime) return;
      const d = new Date(e.startTime);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    });
    return map;
  }, [events]);

  const rows: MonthCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }

  return (
    <View style={styles.monthGrid}>
      <View style={[styles.monthDayHeaders, { borderBottomColor: T.border }]}>
        {DAY_LABELS.map((d, i) => (
          <Text
            key={d}
            style={[styles.monthDayHeader, { color: i === 4 ? DOMAIN_COLORS.calendar : T.textDim }]}
          >
            {d.charAt(0)}
          </Text>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={[styles.monthRow, { borderBottomColor: T.border }]}>
          {row.map((cell, ci) => {
            const isToday = cell.date !== null && isSameDay(cell.date, today);
            const isSelected = cell.date !== null && isSameDay(cell.date, selectedDate);
            const dateKey = cell.date
              ? `${cell.date.getFullYear()}-${cell.date.getMonth()}-${cell.date.getDate()}`
              : "";
            const cellEvents = eventsByDate.get(dateKey) ?? [];
            const visibleEvents = cellEvents.slice(0, MAX_EVENTS_PER_CELL);
            const moreCount = cellEvents.length - MAX_EVENTS_PER_CELL;

            return (
              <TouchableOpacity
                key={ci}
                style={[styles.monthCell, { borderRightColor: T.border }]}
                onPress={() => cell.date !== null && onSelectDate(cell.date)}
                activeOpacity={0.7}
              >
                <View style={[styles.monthCellHeader]}>
                  <View
                    style={[
                      styles.monthCellCircle,
                      isToday && { backgroundColor: DOMAIN_COLORS.calendar },
                    ]}
                  >
                    <Text
                      style={[
                        styles.monthCellNum,
                        {
                          color: isToday
                            ? "#fff"
                            : cell.isCurrentMonth
                              ? T.textBright
                              : T.textDim + "60",
                        },
                      ]}
                    >
                      {cell.day}
                    </Text>
                  </View>
                </View>
                <View style={styles.monthCellEvents}>
                  {visibleEvents.map((evt) => {
                    const color = getEventColor(evt, categoriesMap);
                    return (
                      <View
                        key={evt.id}
                        style={[styles.monthCellEventChip, { backgroundColor: color + "30" }]}
                      >
                        <Text
                          style={[styles.monthCellEventText, { color: T.textBright }]}
                          numberOfLines={1}
                        >
                          {evt.title}
                        </Text>
                      </View>
                    );
                  })}
                  {moreCount > 0 && (
                    <Text style={[styles.monthCellMore, { color: T.textDim }]}>+{moreCount}</Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export default function CalendarScreen() {
  const T = useTheme();
  const today = useMemo(() => new Date(), []);
  const [currentMonth, setCurrentMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selectedDate, setSelectedDate] = useState(today);
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [activeCategoryIds, setActiveCategoryIds] = useState<Set<string>>(new Set());
  const dayScrollRef = useRef<ScrollView>(null);

  const weekStart = useMemo(() => startOfWeek(selectedDate), [selectedDate]);
  const weekDates = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  const rangeStart = useMemo(() => {
    if (viewMode === "month") return startOfMonth(currentMonth).toISOString();
    return weekStart.toISOString();
  }, [viewMode, currentMonth, weekStart]);

  const rangeEnd = useMemo(() => {
    if (viewMode === "month") return endOfMonth(currentMonth).toISOString();
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 7);
    return end.toISOString();
  }, [viewMode, currentMonth, weekStart]);

  const eventsQuery = useEventsInRange(rangeStart, rangeEnd);
  const categoriesQuery = useCategories();

  const categoriesMap = useMemo(() => {
    const map = new Map<string, SerializedCategory>();
    categoriesQuery.data?.forEach((c) => map.set(c.id, c));
    return map;
  }, [categoriesQuery.data]);

  const categories = categoriesQuery.data ?? [];

  const toggleCategory = useCallback((catId: string) => {
    setActiveCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) {
        next.delete(catId);
      } else {
        next.add(catId);
      }
      return next;
    });
  }, []);

  // Filter function: if no categories selected, show all; otherwise filter by selected
  const matchesFilter = useCallback(
    (event: SerializedEvent) => {
      if (activeCategoryIds.size === 0) return true;
      return activeCategoryIds.has(event.categoryId);
    },
    [activeCategoryIds],
  );

  const dayEvents = useMemo(() => {
    if (!eventsQuery.data) return [];
    return eventsQuery.data
      .filter((e) => {
        if (!e.startTime) return false;
        return isSameDay(new Date(e.startTime), selectedDate) && matchesFilter(e);
      })
      .sort((a, b) => {
        if (!a.startTime || !b.startTime) return 0;
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      });
  }, [eventsQuery.data, selectedDate, matchesFilter]);

  const rangeEvents = useMemo(() => {
    if (!eventsQuery.data) return [];
    return eventsQuery.data.filter(matchesFilter);
  }, [eventsQuery.data, matchesFilter]);

  // Auto-scroll to current time when day view becomes visible
  const hasData = !!eventsQuery.data;
  useEffect(() => {
    if (viewMode === "day" && dayScrollRef.current) {
      const now = new Date();
      const scrollTo = Math.max(0, (now.getHours() - 1) * HOUR_HEIGHT);
      setTimeout(() => {
        dayScrollRef.current?.scrollTo({ y: scrollTo, animated: false });
      }, 100);
    }
  }, [viewMode, selectedDate, hasData]);

  const goToPrevMonth = useCallback(() => {
    setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  }, []);

  const goToNextMonth = useCallback(() => {
    setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));
  }, []);

  const goToToday = useCallback(() => {
    const now = new Date();
    setSelectedDate(now);
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  }, []);

  const selectedDayIndex = weekDates.findIndex((d) => isSameDay(d, selectedDate));

  // Current time position for the indicator line
  const now = new Date();
  const currentTimeTop = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_HEIGHT;
  const isSelectedToday = isSameDay(selectedDate, today);

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="Calendar"
        color={DOMAIN_COLORS.calendar}
        icon="calendar"
        rightActions={
          <TouchableOpacity
            onPress={() => router.push("/calendar/create" as any)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Plus size={21} color={T.accent} weight="bold" />
          </TouchableOpacity>
        }
      />

      <View
        style={[styles.controlsBar, { backgroundColor: T.surface, borderBottomColor: T.border }]}
      >
        <TouchableOpacity
          style={[styles.todayBtn, { borderColor: T.border }]}
          onPress={goToToday}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.todayLink, { color: T.accent }]}>Today</Text>
        </TouchableOpacity>
        <View style={[styles.viewToggle, { backgroundColor: T.pageBg, borderColor: T.border }]}>
          {(["day", "month"] as ViewMode[]).map((mode) => (
            <TouchableOpacity
              key={mode}
              onPress={() => setViewMode(mode)}
              style={[
                styles.viewToggleBtn,
                viewMode === mode && { backgroundColor: DOMAIN_COLORS.calendar },
              ]}
            >
              <Text
                style={[
                  styles.viewToggleBtnText,
                  { color: viewMode === mode ? "#fff" : T.textDim },
                ]}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={[styles.monthNav, { backgroundColor: T.bg, borderBottomColor: T.border }]}>
        <TouchableOpacity onPress={goToPrevMonth}>
          <CaretLeft size={18} color={T.text} weight="bold" />
        </TouchableOpacity>
        <Text style={[styles.monthText, { color: T.textBright }]}>
          {getMonthLabel(currentMonth)}
        </Text>
        <TouchableOpacity onPress={goToNextMonth}>
          <CaretRight size={18} color={T.text} weight="bold" />
        </TouchableOpacity>
      </View>

      {/* Category filter chips */}
      {categories.length > 0 && (
        <View style={[styles.categoryBar, { borderBottomColor: T.border }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryBarContent}
          >
            {categories.map((cat) => {
              const isActive = activeCategoryIds.has(cat.id);
              return (
                <TouchableOpacity
                  key={cat.id}
                  style={[
                    styles.categoryChip,
                    { borderColor: isActive ? cat.color : T.border },
                    isActive && { backgroundColor: cat.color + "18" },
                  ]}
                  onPress={() => toggleCategory(cat.id)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.categoryDot, { backgroundColor: cat.color }]} />
                  <Text
                    style={[styles.categoryText, { color: isActive ? T.textBright : T.textDim }]}
                  >
                    {cat.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {viewMode === "day" ? (
        <>
          <View style={[styles.weekStrip, { backgroundColor: T.bg, borderBottomColor: T.border }]}>
            {weekDates.map((d, i) => {
              const isDayToday = isSameDay(d, today);
              const isSelected = i === selectedDayIndex;
              return (
                <TouchableOpacity
                  key={i}
                  style={styles.dayItem}
                  onPress={() => setSelectedDate(new Date(d))}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.dayLabel,
                      { color: isSelected ? DOMAIN_COLORS.calendar : T.textDim },
                    ]}
                  >
                    {DAY_LABELS[i]}
                  </Text>
                  <View
                    style={[
                      styles.dayCircle,
                      isSelected && { backgroundColor: DOMAIN_COLORS.calendar },
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayNum,
                        {
                          color: isSelected
                            ? "#fff"
                            : isDayToday
                              ? DOMAIN_COLORS.calendar
                              : T.textBright,
                        },
                      ]}
                    >
                      {d.getDate()}
                    </Text>
                  </View>
                  {isDayToday && (
                    <View
                      style={[
                        styles.todayDot,
                        { backgroundColor: isSelected ? "#fff" : DOMAIN_COLORS.calendar },
                      ]}
                    />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {eventsQuery.isLoading && !eventsQuery.data ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={DOMAIN_COLORS.calendar} />
            </View>
          ) : (
            <ScrollView
              ref={dayScrollRef}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ height: GRID_HEIGHT + 20 }}
              refreshControl={
                <RefreshControl
                  refreshing={eventsQuery.isFetching && !eventsQuery.isLoading}
                  onRefresh={() => eventsQuery.refetch()}
                  tintColor={DOMAIN_COLORS.calendar}
                  colors={[DOMAIN_COLORS.calendar]}
                />
              }
            >
              <View style={styles.timeGrid}>
                {/* Hour lines + labels */}
                {Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => {
                  const hour = HOUR_START + i;
                  if (hour > HOUR_END) return null;
                  const top = i * HOUR_HEIGHT;
                  return (
                    <React.Fragment key={hour}>
                      <Text style={[styles.hourLabel, { top: top - 7, color: T.textDim }]}>
                        {formatHourLabel(hour)}
                      </Text>
                      <View style={[styles.hourLine, { top, backgroundColor: T.border }]} />
                    </React.Fragment>
                  );
                })}

                {/* Current time indicator */}
                {isSelectedToday && (
                  <View style={[styles.currentTimeRow, { top: currentTimeTop }]}>
                    <View
                      style={[styles.currentTimeDot, { backgroundColor: DOMAIN_COLORS.calendar }]}
                    />
                    <View
                      style={[styles.currentTimeLine, { backgroundColor: DOMAIN_COLORS.calendar }]}
                    />
                  </View>
                )}

                {/* Events positioned on the grid */}
                {dayEvents.map((event) => {
                  const color = getEventColor(event, categoriesMap);
                  const startMin = event.startTime ? getMinutesSinceMidnight(event.startTime) : 0;
                  const endMin = event.endTime
                    ? getMinutesSinceMidnight(event.endTime)
                    : startMin + 30;
                  const top = (startMin / 60) * HOUR_HEIGHT;
                  const height = Math.max(((endMin - startMin) / 60) * HOUR_HEIGHT, 28);

                  return (
                    <TouchableOpacity
                      key={event.id}
                      style={[
                        styles.gridEvent,
                        {
                          top,
                          height,
                          backgroundColor: color + "18",
                          borderLeftColor: color,
                        },
                      ]}
                      onPress={() => router.push(`/calendar/${event.id}` as any)}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[styles.gridEventTitle, { color: T.textBright }]}
                        numberOfLines={1}
                      >
                        {event.title}
                      </Text>
                      {height >= 40 && (
                        <Text
                          style={[styles.gridEventMeta, { color: T.textDim }]}
                          numberOfLines={1}
                        >
                          {event.startTimeFormatted} – {event.endTimeFormatted}
                          {event.location ? ` · ${event.location}` : ""}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          )}
        </>
      ) : (
        <>
          {eventsQuery.isLoading && !eventsQuery.data ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={DOMAIN_COLORS.calendar} />
            </View>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={eventsQuery.isFetching && !eventsQuery.isLoading}
                  onRefresh={() => eventsQuery.refetch()}
                  tintColor={DOMAIN_COLORS.calendar}
                  colors={[DOMAIN_COLORS.calendar]}
                />
              }
            >
              <MonthGrid
                T={T}
                currentMonth={currentMonth}
                selectedDate={selectedDate}
                onSelectDate={(d) => {
                  setSelectedDate(d);
                  setCurrentMonth(new Date(d.getFullYear(), d.getMonth(), 1));
                  setViewMode("day");
                }}
                events={rangeEvents}
                categoriesMap={categoriesMap}
              />
            </ScrollView>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  controlsBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  todayBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  todayLink: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  viewToggle: {
    flexDirection: "row",
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  viewToggleBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  viewToggleBtnText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  monthText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  weekStrip: {
    flexDirection: "row",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dayItem: { flex: 1, alignItems: "center", gap: 4 },
  dayLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  dayCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  dayNum: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  todayDot: { width: 4, height: 4, borderRadius: 2 },
  // ---- Time grid (day view) ----
  timeGrid: {
    position: "relative",
    marginTop: 10,
  },
  hourLabel: {
    position: "absolute",
    left: 0,
    width: TIME_COL_WIDTH,
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "right",
    paddingRight: 8,
    lineHeight: 14,
  },
  hourLine: {
    position: "absolute",
    left: TIME_COL_WIDTH,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
  currentTimeRow: {
    position: "absolute",
    left: TIME_COL_WIDTH - 5,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    zIndex: 20,
    height: 0,
  },
  currentTimeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: -5,
  },
  currentTimeLine: {
    flex: 1,
    height: 2,
    marginTop: -1,
  },
  gridEvent: {
    position: "absolute",
    left: TIME_COL_WIDTH + 4,
    right: 12,
    borderLeftWidth: 3,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    overflow: "hidden",
    zIndex: 10,
  },
  gridEventTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  gridEventMeta: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  // ---- Month view ----
  monthGrid: {},
  monthDayHeaders: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  monthDayHeader: {
    flex: 1,
    textAlign: "center",
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.4,
  },
  monthRow: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 90,
  },
  monthCell: {
    flex: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingBottom: 2,
  },
  monthCellHeader: {
    alignItems: "center",
    paddingTop: 4,
    paddingBottom: 2,
  },
  monthCellCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  monthCellNum: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  monthCellEvents: {
    paddingHorizontal: 2,
    gap: 1,
  },
  monthCellEventChip: {
    borderRadius: 3,
    paddingHorizontal: 3,
    paddingVertical: 1,
  },
  monthCellEventText: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
  },
  monthCellMore: {
    fontSize: 9,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    paddingTop: 1,
  },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  // ---- Category filter bar ----
  categoryBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  categoryBarContent: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    flexDirection: "row",
  },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  categoryDot: { width: 8, height: 8, borderRadius: 4 },
  categoryText: { fontSize: 12, fontFamily: "Inter_500Medium" },
});
