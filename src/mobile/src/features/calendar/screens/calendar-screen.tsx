import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Plus, CaretLeft, CaretRight, CaretDown, Funnel, Target, Warning } from "phosphor-react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@shared/hooks/useTheme";
import { useAuth } from "@core/providers/auth-context";
import { ActionSheet } from "@shared/components/ActionSheet";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useEventsInRange, useCategories } from "@features/calendar/useCalendar";
import { CalendarFilterSheet } from "@features/calendar/components/CalendarFilterSheet";
import type { SerializedEvent, SerializedCategory } from "@features/calendar/calendarSerializer";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type ViewMode = "day" | "week" | "month";
type CalendarScope = "mine" | "org" | "all";

const HITSLOP = { top: 8, bottom: 8, left: 8, right: 8 };

const SCOPE_LABEL: Record<CalendarScope, string> = {
  mine: "Mine",
  org: "Organization",
  all: "All events",
};

const SCOPES: { key: CalendarScope; icon: string; sublabel: string }[] = [
  { key: "mine", icon: "user", sublabel: "Events you organize or attend" },
  { key: "org", icon: "buildings", sublabel: "Shared with the whole organization" },
  { key: "all", icon: "stack", sublabel: "Everything you can access" },
];

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

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function minutesToHHMM(min: number): string {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}

// Drag-to-create: long-press the day grid to drop a one-hour draft slot that
// snaps in 15-minute steps while dragging (MS Teams-style).
const SNAP_MINUTES = 15;
const DRAFT_DURATION_MIN = 60;
const MAX_DRAFT_START_MIN = 24 * 60 - DRAFT_DURATION_MIN;

function getMinutesSinceMidnight(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

type EventSpan = { id: string; startMin: number; endMin: number };
type EventPlacement = { colIndex: number; colCount: number; conflict: boolean };

// Pack overlapping events into side-by-side columns. Events are grouped into
// clusters of mutual overlap; within a cluster each event takes the first
// column whose previous event has already ended. colCount is the cluster's
// peak concurrency, so every event in a cluster shares the same width.
function packEventColumns(spans: EventSpan[]): Map<string, EventPlacement> {
  const sorted = [...spans].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const placement = new Map<string, EventPlacement>();
  let cluster: EventSpan[] = [];
  let clusterEnd = -1;

  const flush = () => {
    const colEnds: number[] = [];
    const colOf = new Map<string, number>();
    for (const ev of cluster) {
      let col = colEnds.findIndex((end) => ev.startMin >= end);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(0);
      }
      colEnds[col] = ev.endMin;
      colOf.set(ev.id, col);
    }
    const colCount = colEnds.length;
    for (const ev of cluster) {
      placement.set(ev.id, {
        colIndex: colOf.get(ev.id) ?? 0,
        colCount,
        conflict: colCount > 1,
      });
    }
  };

  for (const ev of sorted) {
    if (cluster.length && ev.startMin >= clusterEnd) {
      flush();
      cluster = [];
      clusterEnd = -1;
    }
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, ev.endMin);
  }
  if (cluster.length) flush();
  return placement;
}

function getEventColor(
  event: SerializedEvent,
  categoriesMap: Map<string, SerializedCategory>,
  fallback: string,
): string {
  if (event.categoryId) {
    const cat = categoriesMap.get(event.categoryId);
    if (cat?.color) return cat.color;
  }
  return fallback;
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
            style={[styles.monthDayHeader, { color: i === 4 ? T.accent : T.textDim }]}
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
                      isToday && { backgroundColor: T.accent },
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
                    const color = getEventColor(evt, categoriesMap, T.accent);
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

function WeekGrid({
  T,
  weekDates,
  selectedDate,
  today,
  events,
  categoriesMap,
  bottomPad,
  onSelectDay,
  onEventPress,
  refreshing,
  onRefresh,
}: {
  T: ReturnType<typeof useTheme>;
  weekDates: Date[];
  selectedDate: Date;
  today: Date;
  events: SerializedEvent[];
  categoriesMap: Map<string, SerializedCategory>;
  bottomPad: number;
  onSelectDay: (d: Date) => void;
  onEventPress: (id: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { width } = useWindowDimensions();
  const dayWidth = (width - TIME_COL_WIDTH) / 7;
  const scrollRef = useRef<ScrollView>(null);
  const todayIdx = weekDates.findIndex((d) => isSameDay(d, today));

  useEffect(() => {
    const now = new Date();
    const y = Math.max(0, (now.getHours() - 1) * HOUR_HEIGHT);
    const t = setTimeout(() => scrollRef.current?.scrollTo({ y, animated: false }), 100);
    return () => clearTimeout(t);
  }, []);

  // One absolute block per event, bucketed by day column. Timed events pack
  // overlaps into side-by-side sub-columns; all-day events stack as short
  // banners at the top of their column.
  const blocks = useMemo(() => {
    const out: {
      key: string;
      event: SerializedEvent;
      allDay: boolean;
      left: number;
      top: number;
      height: number;
      width: number;
    }[] = [];
    weekDates.forEach((wd, dayIdx) => {
      const dayEvents = events.filter((e) => e.startTime && isSameDay(new Date(e.startTime), wd));
      const timed = dayEvents.filter((e) => !e.isAllDay);
      const allDay = dayEvents.filter((e) => e.isAllDay);
      const spans = timed.map((e) => {
        const startMin = getMinutesSinceMidnight(e.startTime);
        let endMin = e.endTime ? getMinutesSinceMidnight(e.endTime) : startMin + 30;
        if (endMin <= startMin) endMin = HOUR_END * 60;
        return { event: e, startMin, endMin };
      });
      const place = packEventColumns(
        spans.map((s) => ({ id: s.event.id, startMin: s.startMin, endMin: s.endMin })),
      );
      const dayLeft = TIME_COL_WIDTH + dayIdx * dayWidth;
      spans.forEach(({ event, startMin, endMin }) => {
        const p = place.get(event.id) ?? { colIndex: 0, colCount: 1, conflict: false };
        const w = dayWidth / p.colCount;
        out.push({
          key: event.id,
          event,
          allDay: false,
          left: dayLeft + p.colIndex * w,
          top: (startMin / 60) * HOUR_HEIGHT,
          height: Math.max(((endMin - startMin) / 60) * HOUR_HEIGHT, 22),
          width: w - 1,
        });
      });
      allDay.forEach((event, i) => {
        out.push({
          key: `${event.id}-ad`,
          event,
          allDay: true,
          left: dayLeft,
          top: i * 17,
          height: 16,
          width: dayWidth - 1,
        });
      });
    });
    return out;
  }, [events, weekDates, dayWidth]);

  const now = new Date();
  const currentTimeTop = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_HEIGHT;

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.weekHeaderRow, { backgroundColor: T.bg, borderBottomColor: T.border }]}>
        <View style={{ width: TIME_COL_WIDTH }} />
        {weekDates.map((d, i) => {
          const isToday = isSameDay(d, today);
          const isSel = isSameDay(d, selectedDate);
          return (
            <TouchableOpacity
              key={i}
              style={styles.weekHeaderCell}
              onPress={() => onSelectDay(d)}
              activeOpacity={0.7}
            >
              <Text
                style={[styles.weekHeaderLabel, { color: isSel ? T.accent : T.textDim }]}
              >
                {DAY_LABELS[i]}
              </Text>
              <View
                style={[styles.weekHeaderCircle, isToday && { backgroundColor: T.accent }]}
              >
                <Text
                  style={[
                    styles.weekHeaderNum,
                    { color: isToday ? "#fff" : isSel ? T.accent : T.textBright },
                  ]}
                >
                  {d.getDate()}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ height: GRID_HEIGHT + 20 + bottomPad }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={T.accent}
            colors={[T.accent]}
          />
        }
      >
        <View style={[styles.weekGridBody, { height: GRID_HEIGHT }]}>
          {Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => {
            const hour = HOUR_START + i;
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

          {weekDates.map((_, i) => (
            <View
              key={`sep-${i}`}
              style={[
                styles.weekDaySep,
                { left: TIME_COL_WIDTH + i * dayWidth, backgroundColor: T.border },
              ]}
            />
          ))}

          {todayIdx >= 0 && (
            <View
              style={[
                styles.weekNowLine,
                {
                  top: currentTimeTop,
                  left: TIME_COL_WIDTH + todayIdx * dayWidth,
                  width: dayWidth,
                  backgroundColor: T.accent,
                },
              ]}
            />
          )}

          {blocks.map((b) => {
            const color = getEventColor(b.event, categoriesMap, T.accent);
            return (
              <TouchableOpacity
                key={b.key}
                style={[
                  styles.weekEvent,
                  {
                    top: b.top,
                    left: b.left,
                    width: b.width,
                    height: b.height,
                    backgroundColor: color + "33",
                    borderColor: color,
                  },
                ]}
                onPress={() => onEventPress(b.event.id)}
                activeOpacity={0.85}
              >
                <Text
                  style={[styles.weekEventText, { color: T.textBright }]}
                  numberOfLines={b.allDay ? 1 : 2}
                >
                  {b.event.title}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

export default function CalendarScreen() {
  const T = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const topPad = (Platform.OS === "web" ? 20 : insets.top) + 12;
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  const today = useMemo(() => new Date(), []);
  const [currentMonth, setCurrentMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selectedDate, setSelectedDate] = useState(today);
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [scope, setScope] = useState<CalendarScope>("mine");
  const [activeCategoryIds, setActiveCategoryIds] = useState<Set<string>>(new Set());
  const [scopeSheetOpen, setScopeSheetOpen] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
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

  // Scope narrows within events already returned (all accessible): "mine" is
  // organizer-or-attendee, "org" is OPEN_TO_ORG. Category chips narrow further.
  const myId = user?.id;
  const matchesFilter = useCallback(
    (event: SerializedEvent) => {
      if (scope === "org" && event.accessMode !== "OPEN_TO_ORG") return false;
      if (
        scope === "mine" &&
        event.organizerId !== myId &&
        !event.attendees.some((a) => a.id === myId)
      ) {
        return false;
      }
      if (activeCategoryIds.size > 0 && !activeCategoryIds.has(event.categoryId)) return false;
      return true;
    },
    [scope, myId, activeCategoryIds],
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

  const { width: windowWidth } = useWindowDimensions();

  // Box + side-by-side column placement for each event, so overlaps sit next
  // to each other instead of stacking. All-day events span the full grid
  // height (00:00-24:00) and pack as their own full-height column.
  const positionedEvents = useMemo(() => {
    const spans = dayEvents.map((event) => {
      if (event.isAllDay) {
        return { event, startMin: HOUR_START * 60, endMin: HOUR_END * 60 };
      }
      const startMin = event.startTime ? getMinutesSinceMidnight(event.startTime) : 0;
      let endMin = event.endTime ? getMinutesSinceMidnight(event.endTime) : startMin + 30;
      // Ends at or past midnight (00:00 reads as minute 0) - fill to day bottom.
      if (endMin <= startMin) endMin = HOUR_END * 60;
      return { event, startMin, endMin };
    });
    // Geometry uses every event so all-day cards sit beside the timed ones.
    const placement = packEventColumns(
      spans.map(({ event, startMin, endMin }) => ({ id: event.id, startMin, endMin })),
    );
    // Conflict is a timed-vs-timed signal; an all-day card overlapping the
    // day's schedule is expected, not a clash.
    const timedConflict = packEventColumns(
      spans
        .filter(({ event }) => !event.isAllDay)
        .map(({ event, startMin, endMin }) => ({ id: event.id, startMin, endMin })),
    );
    const areaWidth = windowWidth - (TIME_COL_WIDTH + 4) - 12;
    return spans.map(({ event, startMin, endMin }) => {
      const place = placement.get(event.id) ?? { colIndex: 0, colCount: 1, conflict: false };
      const colWidth = areaWidth / place.colCount;
      return {
        event,
        top: (startMin / 60) * HOUR_HEIGHT,
        height: Math.max(((endMin - startMin) / 60) * HOUR_HEIGHT, 28),
        left: TIME_COL_WIDTH + 4 + place.colIndex * colWidth,
        width: colWidth - (place.colCount > 1 ? 3 : 0),
        conflict: event.isAllDay ? false : (timedConflict.get(event.id)?.conflict ?? false),
      };
    });
  }, [dayEvents, windowWidth]);

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

  // Prev/next moves the period the active view actually renders: a week in day
  // mode (day view is driven by selectedDate's week), a month in month mode.
  const shiftWeek = useCallback((delta: number) => {
    setSelectedDate((d) => {
      const next = new Date(d);
      next.setDate(next.getDate() + delta * 7);
      return next;
    });
  }, []);

  const goPrev = useCallback(() => {
    if (viewMode === "month") {
      setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
    } else {
      shiftWeek(-1);
    }
  }, [viewMode, shiftWeek]);

  const goNext = useCallback(() => {
    if (viewMode === "month") {
      setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));
    } else {
      shiftWeek(1);
    }
  }, [viewMode, shiftWeek]);

  const setView = useCallback(
    (mode: ViewMode) => {
      if (mode === "month") {
        setCurrentMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
      }
      setViewMode(mode);
    },
    [selectedDate],
  );

  const goToToday = useCallback(() => {
    const now = new Date();
    setSelectedDate(now);
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  }, []);

  const periodLabel =
    viewMode === "month" ? getMonthLabel(currentMonth) : getMonthLabel(selectedDate);
  const isOnToday =
    viewMode === "month"
      ? currentMonth.getFullYear() === today.getFullYear() &&
        currentMonth.getMonth() === today.getMonth()
      : viewMode === "week"
        ? weekDates.some((d) => isSameDay(d, today))
        : isSameDay(selectedDate, today);

  const [draftStartMin, setDraftStartMin] = useState<number | null>(null);
  const draftAnchorRef = useRef(0);
  const draftStartRef = useRef<number | null>(null);

  const beginDraft = useCallback((y: number) => {
    const touchedMin = (y / HOUR_HEIGHT) * 60;
    const start = Math.min(
      MAX_DRAFT_START_MIN,
      Math.max(0, Math.floor(touchedMin / SNAP_MINUTES) * SNAP_MINUTES),
    );
    draftAnchorRef.current = start;
    draftStartRef.current = start;
    setDraftStartMin(start);
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
  }, []);

  const moveDraft = useCallback((translationY: number) => {
    const deltaMin = Math.round(((translationY / HOUR_HEIGHT) * 60) / SNAP_MINUTES) * SNAP_MINUTES;
    const next = Math.min(MAX_DRAFT_START_MIN, Math.max(0, draftAnchorRef.current + deltaMin));
    if (next !== draftStartRef.current) {
      draftStartRef.current = next;
      setDraftStartMin(next);
      if (Platform.OS !== "web") {
        Haptics.selectionAsync().catch(() => {});
      }
    }
  }, []);

  const finishDraft = useCallback(
    (commit: boolean) => {
      const start = draftStartRef.current;
      draftStartRef.current = null;
      setDraftStartMin(null);
      if (!commit || start === null) return;
      const d = selectedDate;
      router.push({
        pathname: "/calendar/create",
        params: {
          date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
          start: minutesToHHMM(start),
          end: minutesToHHMM(start + DRAFT_DURATION_MIN),
        },
      } as any);
    },
    [selectedDate],
  );

  const dragCreateGesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(300)
        .onStart((e) => {
          runOnJS(beginDraft)(e.y);
        })
        .onUpdate((e) => {
          runOnJS(moveDraft)(e.translationY);
        })
        .onEnd(() => {
          runOnJS(finishDraft)(true);
        })
        .onFinalize(() => {
          // No-op after a committed end (the ref is already cleared); clears
          // the draft when the gesture is cancelled instead of released.
          runOnJS(finishDraft)(false);
        }),
    [beginDraft, moveDraft, finishDraft],
  );

  const selectedDayIndex = weekDates.findIndex((d) => isSameDay(d, selectedDate));

  // Current time position for the indicator line
  const now = new Date();
  const currentTimeTop = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_HEIGHT;
  const isSelectedToday = isSameDay(selectedDate, today);

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: T.bg, borderBottomColor: T.border, paddingTop: topPad },
        ]}
      >
        <TouchableOpacity
          style={[styles.scopePill, { backgroundColor: T.surface, borderColor: T.border }]}
          onPress={() => setScopeSheetOpen(true)}
          activeOpacity={0.7}
          accessibilityLabel="Choose which events to show"
        >
          <Text style={[styles.scopePillText, { color: T.textBright }]}>{SCOPE_LABEL[scope]}</Text>
          <CaretDown size={13} color={T.textDim} weight="bold" />
        </TouchableOpacity>

        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={goToToday}
            hitSlop={HITSLOP}
            accessibilityLabel="Go to today"
          >
            <Target size={21} color={isOnToday ? T.textDim : T.accent} weight="bold" />
          </TouchableOpacity>
          {categories.length > 0 && (
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => setFilterSheetOpen(true)}
              hitSlop={HITSLOP}
              accessibilityLabel="Filter by category"
            >
              <Funnel
                size={20}
                color={activeCategoryIds.size > 0 ? T.accent : T.textDim}
                weight={activeCategoryIds.size > 0 ? "fill" : "regular"}
              />
              {activeCategoryIds.size > 0 && (
                <View
                  style={[styles.filterDot, { backgroundColor: T.accent, borderColor: T.bg }]}
                />
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => router.push("/calendar/create" as any)}
            hitSlop={HITSLOP}
            accessibilityLabel="New event"
          >
            <Plus size={22} color={T.accent} weight="bold" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.periodBar, { backgroundColor: T.surface, borderBottomColor: T.border }]}>
        <View style={styles.periodNav}>
          <TouchableOpacity onPress={goPrev} hitSlop={HITSLOP} accessibilityLabel="Previous">
            <CaretLeft size={18} color={T.text} weight="bold" />
          </TouchableOpacity>
          <Text style={[styles.monthText, { color: T.textBright }]}>{periodLabel}</Text>
          <TouchableOpacity onPress={goNext} hitSlop={HITSLOP} accessibilityLabel="Next">
            <CaretRight size={18} color={T.text} weight="bold" />
          </TouchableOpacity>
        </View>
        <View style={[styles.viewToggle, { backgroundColor: T.pageBg, borderColor: T.border }]}>
          {(["day", "week", "month"] as ViewMode[]).map((mode) => (
            <TouchableOpacity
              key={mode}
              onPress={() => setView(mode)}
              style={[
                styles.viewToggleBtn,
                viewMode === mode && { backgroundColor: T.accent },
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
                      { color: isSelected ? T.accent : T.textDim },
                    ]}
                  >
                    {DAY_LABELS[i]}
                  </Text>
                  <View
                    style={[
                      styles.dayCircle,
                      isSelected && { backgroundColor: T.accent },
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayNum,
                        {
                          color: isSelected
                            ? "#fff"
                            : isDayToday
                              ? T.accent
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
                        { backgroundColor: isSelected ? "#fff" : T.accent },
                      ]}
                    />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {eventsQuery.isLoading && !eventsQuery.data ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={T.accent} />
            </View>
          ) : (
            <ScrollView
              ref={dayScrollRef}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ height: GRID_HEIGHT + 20 + bottomPad }}
              scrollEnabled={draftStartMin === null}
              refreshControl={
                <RefreshControl
                  refreshing={eventsQuery.isFetching && !eventsQuery.isLoading}
                  onRefresh={() => eventsQuery.refetch()}
                  tintColor={T.accent}
                  colors={[T.accent]}
                />
              }
            >
              <GestureDetector gesture={dragCreateGesture}>
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
                    <View style={[styles.currentTimeRow, { top: currentTimeTop - 5 }]}>
                      <View
                        style={[styles.currentTimeDot, { backgroundColor: T.accent }]}
                      />
                      <View
                        style={[styles.currentTimeLine, { backgroundColor: T.accent }]}
                      />
                    </View>
                  )}

                  {/* Events positioned on the grid */}
                  {positionedEvents.map(({ event, top, height, left, width, conflict }) => {
                    const color = getEventColor(event, categoriesMap, T.accent);
                    const attendeeLabel = event.attendees.map((a) => a.name).join(", ");
                    const isAllDay = event.isAllDay;
                    const showSecondRow = !isAllDay && height >= 44;

                    return (
                      <TouchableOpacity
                        key={event.id}
                        style={[
                          styles.gridEvent,
                          // All-day cards fill the whole column; keep their text
                          // near the top instead of pushed to the far bottom.
                          isAllDay && styles.gridEventAllDay,
                          {
                            top,
                            height,
                            left,
                            width,
                            backgroundColor: color + "33",
                            borderColor: conflict ? T.red : color,
                          },
                        ]}
                        onPress={() => router.push(`/calendar/${event.id}` as any)}
                        activeOpacity={0.85}
                      >
                        <View style={styles.gridEventRow}>
                          <View style={styles.gridEventTitleWrap}>
                            {conflict ? <Warning size={12} color={T.red} weight="fill" /> : null}
                            <Text
                              style={[styles.gridEventTitle, { color: T.textBright }]}
                              numberOfLines={1}
                            >
                              {event.title}
                            </Text>
                          </View>
                          <Text style={[styles.gridEventTime, { color: T.textBright }]}>
                            {isAllDay ? "All day" : event.startTimeFormatted}
                          </Text>
                        </View>
                        {isAllDay && attendeeLabel ? (
                          <Text
                            style={[styles.gridEventDetail, { color: T.textDim }]}
                            numberOfLines={1}
                          >
                            {attendeeLabel}
                          </Text>
                        ) : null}
                        {showSecondRow ? (
                          <View style={styles.gridEventRow}>
                            <Text
                              style={[styles.gridEventDetail, { color: T.textDim }]}
                              numberOfLines={1}
                            >
                              {attendeeLabel}
                            </Text>
                            <Text style={[styles.gridEventEndTime, { color: T.textDim }]}>
                              {event.endTimeFormatted}
                            </Text>
                          </View>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}

                  {/* Drag-to-create draft slot: same card as an event, times
                      updating live in the top/bottom-right corners as it moves. */}
                  {draftStartMin !== null && (
                    <View
                      pointerEvents="none"
                      style={[
                        styles.gridEvent,
                        styles.draftSlot,
                        {
                          top: (draftStartMin / 60) * HOUR_HEIGHT,
                          left: TIME_COL_WIDTH + 4,
                          right: 12,
                          height: (DRAFT_DURATION_MIN / 60) * HOUR_HEIGHT,
                          borderColor: T.accent,
                          backgroundColor: T.accent + "33",
                        },
                      ]}
                    >
                      <View style={styles.gridEventRow}>
                        <Text
                          style={[styles.gridEventTitle, { color: T.textBright }]}
                          numberOfLines={1}
                        >
                          New event
                        </Text>
                        <Text style={[styles.gridEventTime, { color: T.textBright }]}>
                          {minutesToHHMM(draftStartMin)}
                        </Text>
                      </View>
                      <View style={styles.gridEventRow}>
                        <View style={styles.gridEventSpacer} />
                        <Text style={[styles.gridEventEndTime, { color: T.textDim }]}>
                          {minutesToHHMM(draftStartMin + DRAFT_DURATION_MIN)}
                        </Text>
                      </View>
                    </View>
                  )}
                </View>
              </GestureDetector>
            </ScrollView>
          )}
        </>
      ) : viewMode === "week" ? (
        eventsQuery.isLoading && !eventsQuery.data ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={T.accent} />
          </View>
        ) : (
          <WeekGrid
            T={T}
            weekDates={weekDates}
            selectedDate={selectedDate}
            today={today}
            events={rangeEvents}
            categoriesMap={categoriesMap}
            bottomPad={bottomPad}
            onSelectDay={(d) => {
              setSelectedDate(new Date(d));
              setViewMode("day");
            }}
            onEventPress={(id) => router.push(`/calendar/${id}` as any)}
            refreshing={eventsQuery.isFetching && !eventsQuery.isLoading}
            onRefresh={() => eventsQuery.refetch()}
          />
        )
      ) : (
        <>
          {eventsQuery.isLoading && !eventsQuery.data ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={T.accent} />
            </View>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: bottomPad }}
              refreshControl={
                <RefreshControl
                  refreshing={eventsQuery.isFetching && !eventsQuery.isLoading}
                  onRefresh={() => eventsQuery.refetch()}
                  tintColor={T.accent}
                  colors={[T.accent]}
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

      <ActionSheet
        visible={scopeSheetOpen}
        onClose={() => setScopeSheetOpen(false)}
        title="Show events"
        icon="calendar"
        iconColor={T.accent}
        actions={SCOPES.map((s) => ({
          icon: scope === s.key ? "check" : s.icon,
          label: SCOPE_LABEL[s.key],
          sublabel: s.sublabel,
          color: scope === s.key ? T.accent : undefined,
          onPress: () => setScope(s.key),
        }))}
      />

      <CalendarFilterSheet
        visible={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        categories={categories}
        activeCategoryIds={activeCategoryIds}
        onToggle={toggleCategory}
        onClear={() => setActiveCategoryIds(new Set())}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scopePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 14,
    paddingRight: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  scopePillText: { fontSize: 14, fontFamily: FONT.semibold },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  iconBtn: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  filterDot: {
    position: "absolute",
    top: 7,
    right: 7,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
  },
  periodBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  periodNav: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  viewToggle: {
    flexDirection: "row",
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  viewToggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  viewToggleBtnText: {
    fontSize: 13,
    fontFamily: FONT.medium,
  },
  monthText: { fontSize: 16, fontFamily: FONT.semibold },
  weekStrip: {
    flexDirection: "row",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dayItem: { flex: 1, alignItems: "center", gap: 4 },
  dayLabel: { fontSize: 11, fontFamily: FONT.medium },
  dayCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  dayNum: { fontSize: 14, fontFamily: FONT.semibold },
  todayDot: { width: 4, height: 4, borderRadius: 2 },
  weekHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  weekHeaderCell: { flex: 1, alignItems: "center", gap: 3, paddingVertical: 2 },
  weekHeaderLabel: { fontSize: 10, fontFamily: FONT.medium },
  weekHeaderCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  weekHeaderNum: { fontSize: 13, fontFamily: FONT.semibold },
  weekGridBody: {
    position: "relative",
    marginTop: 10,
  },
  weekDaySep: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
  },
  weekNowLine: {
    position: "absolute",
    height: 2,
    zIndex: 20,
  },
  weekEvent: {
    position: "absolute",
    borderRadius: 5,
    borderWidth: 1,
    paddingHorizontal: 3,
    paddingVertical: 2,
    overflow: "hidden",
    zIndex: 10,
  },
  weekEventText: { fontSize: 9, fontFamily: FONT.medium },
  // Explicit height so the drag-to-create gesture (and touches near the
  // bottom of the day) land inside the grid's hit area.
  timeGrid: {
    position: "relative",
    marginTop: 10,
    height: GRID_HEIGHT,
  },
  hourLabel: {
    position: "absolute",
    left: 0,
    width: TIME_COL_WIDTH,
    fontSize: 11,
    fontFamily: FONT.regular,
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
  // The row is 10px tall and shifted up by half so dot and line share the
  // same vertical center on the exact current-time y.
  currentTimeRow: {
    position: "absolute",
    left: TIME_COL_WIDTH - 5,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    zIndex: 20,
    height: 10,
  },
  currentTimeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  currentTimeLine: {
    flex: 1,
    height: 2,
  },
  gridEvent: {
    position: "absolute",
    borderRadius: 10,
    borderWidth: 1.5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    overflow: "hidden",
    zIndex: 10,
    // Title/start ride the top edge, participants/end the bottom edge.
    justifyContent: "space-between",
  },
  gridEventAllDay: {
    justifyContent: "flex-start",
    gap: 3,
  },
  gridEventRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  gridEventTitleWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  gridEventSpacer: {
    flex: 1,
  },
  gridEventTitle: {
    fontSize: 13,
    fontFamily: FONT.semibold,
    flexShrink: 1,
  },
  gridEventTime: {
    fontSize: 12,
    fontFamily: FONT.semibold,
  },
  gridEventEndTime: {
    fontSize: 12,
    fontFamily: FONT.medium,
  },
  gridEventDetail: {
    fontSize: 12,
    fontFamily: FONT.regular,
    flex: 1,
  },
  draftSlot: {
    zIndex: 30,
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
    fontFamily: FONT.semibold,
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
    fontFamily: FONT.medium,
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
    fontFamily: FONT.medium,
  },
  monthCellMore: {
    fontSize: 9,
    fontFamily: FONT.medium,
    textAlign: "center",
    paddingTop: 1,
  },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
});
