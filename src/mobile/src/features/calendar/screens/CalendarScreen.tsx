import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Platform,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import Svg, { Line } from "react-native-svg";
import * as Haptics from "expo-haptics";
import { AirplaneTilt, Funnel, Plus, Target, Warning } from "phosphor-react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useDateTimePrefs, type WeekStartDay } from "@core/datetimePrefs";
import {
  instantFromZonedWall,
  localDayKey,
  zonedDayKey,
  zonedMinutesSinceMidnight,
  zonedParts,
} from "@shared/lib/zonedTime";
import { RecurrenceEditScope } from "@uniffy/proto/cal/v1/calendar_pb";
import {
  useCalendarPolicy,
  useCalendars,
  useEventsInRange,
  useCategories,
} from "@features/calendar/useCalendar";
import { ShareSheet } from "@shared/permissions/ShareSheet";
import { memberCommitments, resolveEventColor } from "@features/calendar/calendarList";
import { useAuth } from "@core/providers/AuthContext";
import { useUpdateEvent } from "@features/calendar/useCalendarMutations";
import { blocksTime, eventDisplayState } from "@features/calendar/eventDisplay";
import { CalendarFilterSheet } from "@features/calendar/components/CalendarFilterSheet";
import { AgendaList } from "@features/calendar/components/AgendaList";
import { AllDayEventChip } from "@features/calendar/components/AllDayEventChip";
import { PeriodRail } from "@features/calendar/components/PeriodRail";
import { railUnitFor, resolveRailSelection, type RailItem } from "@features/calendar/periodRail";
import { RecurrenceScopeSheet } from "@features/calendar/components/RecurrenceScopeSheet";
import { OCCURRENCE_SEPARATOR } from "@features/calendar/calendarSerializer";
import type {
  SerializedCalendar,
  SerializedCategory,
  SerializedEvent,
} from "@features/calendar/calendarSerializer";
import { useActiveCalls } from "@features/calls/useCallsState";
import { useTags } from "@features/tags/useTags";
import { roleCanEdit } from "@shared/permissions/contentRoles";
import { userFacingError } from "@shared/lib/userFacingError";

const BASE_DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayLabelsFrom(weekStartsOn: WeekStartDay): string[] {
  return Array.from({ length: 7 }, (_, i) => BASE_DAY_LABELS[(weekStartsOn + i) % 7]);
}

type ViewMode = "day" | "week" | "month" | "agenda";

const VIEW_LABELS: Record<ViewMode, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  agenda: "Agenda",
};

const HITSLOP = { top: 8, bottom: 8, left: 8, right: 8 };

// Hour grid config
const HOUR_START = 0; // midnight
const HOUR_END = 24;
const HOUR_HEIGHT = 60; // px per hour

// A block is sized by the event's DURATION, never by its text, so a short event
// has to be told how much prose actually fits. The unit is a whole line: half a
// line of sliced glyphs reads as a rendering fault, where one honest line reads
// as a summary. Line heights are declared rather than left to the font so the
// arithmetic here and the rendered text cannot disagree.
const BLOCK_BORDER = 3;
const BLOCK_PAD_Y = 7;
const BLOCK_TIGHT_PAD_Y = 3;
const TITLE_LINE = 16;
const DETAIL_LINE = 15;
const WEEK_PAD_Y = 2;
const WEEK_BORDER = 2;
const WEEK_LINE = 12;
const ALLDAY_ROW_HEIGHT = 24;

type BlockText = { padY: number; rows: 1 | 2; title: number; detail: number };

// Padding is spent last: squeezing it buys a second line, and a block dense
// with text still beats a roomy one that hides who is attending.
function fitBlockText(height: number, fontScale: number): BlockText {
  const title = Math.round(TITLE_LINE * fontScale);
  const detail = Math.round(DETAIL_LINE * fontScale);
  const room = (pad: number) => height - BLOCK_BORDER - pad * 2;
  const pads = [BLOCK_PAD_Y, BLOCK_TIGHT_PAD_Y];
  for (const padY of pads) {
    if (room(padY) >= title + detail) return { padY, rows: 2, title, detail };
  }
  for (const padY of pads) {
    if (room(padY) >= title) return { padY, rows: 1, title, detail };
  }
  return { padY: BLOCK_TIGHT_PAD_Y, rows: 1, title, detail };
}

// Floor for a block's height: enough for its title at the reader's text size.
// Without it the shortest events are boxes too small for the one line they must
// show, and no amount of padding arithmetic downstream can rescue that.
function minBlockHeight(fontScale: number) {
  return BLOCK_BORDER + BLOCK_TIGHT_PAD_Y * 2 + Math.round(TITLE_LINE * fontScale);
}
const GRID_HEIGHT = (HOUR_END - HOUR_START) * HOUR_HEIGHT;
const TIME_COL_WIDTH = 56;

function startOfWeek(date: Date, weekStartsOn: WeekStartDay): Date {
  const d = new Date(date);
  const diff = (d.getDay() - weekStartsOn + 7) % 7;
  d.setDate(d.getDate() - diff);
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

function formatHourLabel(hour: number): string {
  if (hour === 0 || hour === 24) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatClockLabel(date: Date): string {
  const p = zonedParts(date);
  const hour = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const meridiem = p.hour < 12 ? "AM" : "PM";
  return `${hour}:${pad2(p.minute)} ${meridiem}`;
}

function minutesToHHMM(min: number): string {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}

// Drag-to-create: long-press the day grid to drop a one-hour draft slot that
// snaps in 15-minute steps while dragging (MS Teams-style).
const SNAP_MINUTES = 15;
const DRAFT_DURATION_MIN = 60;
const MAX_DRAFT_START_MIN = 24 * 60 - DRAFT_DURATION_MIN;

// Wall-clock position of an instant on the grid, read in the display zone.
function getMinutesSinceMidnight(iso: string): number {
  return zonedMinutesSinceMidnight(iso);
}

// A multi-day event belongs to every display-zone day its [start, end] touches,
// not only the day it starts; each covered day repeats the same clock band.
function eventCoversDay(event: SerializedEvent, dayKey: string): boolean {
  if (!event.startTime) return false;
  const startKey = zonedDayKey(event.startTime);
  const endKey = event.endTime ? zonedDayKey(event.endTime) : startKey;
  return startKey <= dayKey && dayKey <= endKey;
}

// Timed blocking events only: cancelled and free events overlap without
// clashing, and all-day events are expected to sit over the whole schedule.
function dayHasConflict(
  events: SerializedEvent[],
  countsAsConflict: (event: SerializedEvent) => boolean,
): boolean {
  const spans = events
    .filter((e) => !e.isAllDay && countsAsConflict(e) && e.startTime)
    .map((e) => {
      const startMin = zonedMinutesSinceMidnight(e.startTime);
      let endMin = e.endTime ? zonedMinutesSinceMidnight(e.endTime) : startMin + 30;
      if (endMin <= startMin) endMin = HOUR_END * 60;
      return { startMin, endMin };
    })
    .sort((a, b) => a.startMin - b.startMin);
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].startMin < spans[i - 1].endMin) return true;
  }
  return false;
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

const MAX_EVENTS_PER_CELL = 3;

type MonthCell = {
  day: number | null;
  date: Date | null;
  isCurrentMonth: boolean;
};

function buildMonthCells(currentMonth: Date, weekStartsOn: WeekStartDay): MonthCell[] {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const leadingBlanks = (firstDayOfWeek - weekStartsOn + 7) % 7;

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
  today,
  onSelectDate,
  events,
  colorOf,
  countsAsConflict,
  weekStartsOn,
  dayLabels,
  liveChannelIds,
}: {
  T: ReturnType<typeof useTheme>;
  currentMonth: Date;
  selectedDate: Date;
  today: Date;
  onSelectDate: (d: Date) => void;
  events: SerializedEvent[];
  colorOf: (event: SerializedEvent) => string;
  countsAsConflict: (event: SerializedEvent) => boolean;
  weekStartsOn: WeekStartDay;
  dayLabels: string[];
  liveChannelIds: ReadonlySet<string>;
}) {
  const cells = useMemo(
    () => buildMonthCells(currentMonth, weekStartsOn),
    [currentMonth, weekStartsOn],
  );

  // Group events under every display-zone day they cover, so a multi-day
  // event shows on each of its days rather than only where it starts.
  const eventsByDate = useMemo(() => {
    const map = new Map<string, SerializedEvent[]>();
    events.forEach((e) => {
      if (!e.startTime) return;
      const endKey = e.endTime ? zonedDayKey(e.endTime) : zonedDayKey(e.startTime);
      const [y, m, d] = zonedDayKey(e.startTime).split("-").map(Number);
      const cursor = new Date(y, m - 1, d);
      // Bounded walk so a malformed end date cannot spin the render.
      for (let i = 0; i < 62; i++) {
        const key = localDayKey(cursor);
        if (key > endKey) break;
        const arr = map.get(key) ?? [];
        arr.push(e);
        map.set(key, arr);
        cursor.setDate(cursor.getDate() + 1);
      }
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
        {dayLabels.map((d) => (
          <Text key={d} style={[styles.monthDayHeader, { color: T.textDim }]}>
            {d.charAt(0)}
          </Text>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={[styles.monthRow, { borderBottomColor: T.border }]}>
          {row.map((cell, ci) => {
            const isToday = cell.date !== null && isSameDay(cell.date, today);
            const dateKey = cell.date ? localDayKey(cell.date) : "";
            const cellEvents = eventsByDate.get(dateKey) ?? [];
            const visibleEvents = cellEvents.slice(0, MAX_EVENTS_PER_CELL);
            const moreCount = cellEvents.length - MAX_EVENTS_PER_CELL;
            const conflict = dayHasConflict(cellEvents, countsAsConflict);

            return (
              <TouchableOpacity
                key={ci}
                style={[styles.monthCell, { borderRightColor: T.border }]}
                onPress={() => cell.date !== null && onSelectDate(cell.date)}
                activeOpacity={0.7}
              >
                {conflict ? (
                  <View style={[styles.monthConflictDot, { backgroundColor: T.red }]} />
                ) : null}
                <View style={[styles.monthCellHeader]}>
                  <View style={[styles.monthCellCircle, isToday && { backgroundColor: T.accent }]}>
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
                    const color = colorOf(evt);
                    const display = eventDisplayState(evt);
                    return (
                      <View
                        key={evt.id}
                        style={[
                          styles.monthCellEventChip,
                          { backgroundColor: color + (display.free ? "18" : "30") },
                          (display.cancelled || display.tentative) && styles.fadedEvent,
                        ]}
                      >
                        {evt.channelId &&
                        liveChannelIds.has(evt.channelId) &&
                        !display.cancelled &&
                        !display.detailsHidden ? (
                          <View style={[styles.monthLiveDot, { backgroundColor: T.red }]} />
                        ) : null}
                        <Text
                          style={[
                            styles.monthCellEventText,
                            { color: T.textBright },
                            display.cancelled && styles.struckTitle,
                          ]}
                          numberOfLines={1}
                        >
                          {display.title}
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
  now,
  events,
  colorOf,
  countsAsConflict,
  bottomPad,
  onSelectDay,
  onEventPress,
  refreshing,
  onRefresh,
  dayLabels,
  liveChannelIds,
}: {
  T: ReturnType<typeof useTheme>;
  weekDates: Date[];
  selectedDate: Date;
  today: Date;
  now: Date;
  events: SerializedEvent[];
  colorOf: (event: SerializedEvent) => string;
  countsAsConflict: (event: SerializedEvent) => boolean;
  bottomPad: number;
  onSelectDay: (d: Date) => void;
  onEventPress: (id: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
  dayLabels: string[];
  liveChannelIds: ReadonlySet<string>;
}) {
  const { width } = useWindowDimensions();
  const dayWidth = (width - TIME_COL_WIDTH) / 7;
  const scrollRef = useRef<ScrollView>(null);
  const todayIdx = weekDates.findIndex((d) => isSameDay(d, today));

  useEffect(() => {
    const y = Math.max(0, (zonedParts(new Date()).hour - 1) * HOUR_HEIGHT);
    const t = setTimeout(() => scrollRef.current?.scrollTo({ y, animated: false }), 100);
    return () => clearTimeout(t);
  }, []);

  // One absolute block per event, bucketed by day column. Timed events pack
  // overlaps into side-by-side sub-columns inside the scrolling grid; all-day
  // events go to a pinned strip under the header, because a banner placed at
  // the canvas top would sit at midnight and the grid opens scrolled to now.
  const { timedBlocks, allDayBars, allDayRows } = useMemo(() => {
    const out: {
      key: string;
      event: SerializedEvent;
      left: number;
      top: number;
      height: number;
      width: number;
      conflict?: boolean;
      showTitle?: boolean;
    }[] = [];
    weekDates.forEach((wd, dayIdx) => {
      const dayKey = localDayKey(wd);
      const dayEvents = events.filter((e) => eventCoversDay(e, dayKey));
      const timed = dayEvents.filter((e) => !e.isAllDay);
      const spans = timed.map((e) => {
        const startMin = getMinutesSinceMidnight(e.startTime);
        let endMin = e.endTime ? getMinutesSinceMidnight(e.endTime) : startMin + 30;
        if (endMin <= startMin) endMin = HOUR_END * 60;
        return { event: e, startMin, endMin };
      });
      const place = packEventColumns(
        spans.map((s) => ({ id: s.event.id, startMin: s.startMin, endMin: s.endMin })),
      );
      // Conflict is a blocking-time signal: cancelled and free events overlap
      // without clashing, so they get geometry above but no flag here.
      const conflictPlace = packEventColumns(
        spans
          .filter((s) => countsAsConflict(s.event))
          .map((s) => ({ id: s.event.id, startMin: s.startMin, endMin: s.endMin })),
      );
      const dayLeft = TIME_COL_WIDTH + dayIdx * dayWidth;
      spans.forEach(({ event, startMin, endMin }) => {
        const p = place.get(event.id) ?? { colIndex: 0, colCount: 1, conflict: false };
        const w = dayWidth / p.colCount;
        out.push({
          key: event.id,
          event,
          left: dayLeft + p.colIndex * w,
          top: (startMin / 60) * HOUR_HEIGHT,
          height: Math.max(
            ((endMin - startMin) / 60) * HOUR_HEIGHT,
            WEEK_BORDER + WEEK_PAD_Y * 2 + WEEK_LINE,
          ),
          width: w - 1,
          conflict: conflictPlace.get(event.id)?.conflict ?? false,
          // Segments of a multi-day event carry the label only where it starts.
          showTitle: zonedDayKey(event.startTime) === dayKey,
        });
      });
    });

    // An all-day event is one continuous bar across every column it covers,
    // clamped to the visible week and stacked into rows: cut into per-day
    // chips, the days after the first carry no title and read as empty boxes.
    const dayKeys = weekDates.map(localDayKey);
    const bars: {
      key: string;
      event: SerializedEvent;
      left: number;
      top: number;
      width: number;
      row: number;
    }[] = [];
    const occupied: Set<number>[] = [];
    const allDay = events
      .filter((e) => e.isAllDay && e.startTime)
      // Longest first so a wide span claims its row before shorter events fill
      // the gaps around it.
      .sort((a, b) => {
        const byStart = new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
        if (byStart !== 0) return byStart;
        return (
          new Date(b.endTime || b.startTime).getTime() -
          new Date(a.endTime || a.startTime).getTime()
        );
      });
    for (const event of allDay) {
      const startKey = zonedDayKey(event.startTime);
      const endKey = event.endTime ? zonedDayKey(event.endTime) : startKey;
      const startCol = dayKeys.findIndex((k) => k >= startKey);
      let endCol = -1;
      for (let i = dayKeys.length - 1; i >= 0; i--) {
        if (dayKeys[i] <= endKey) {
          endCol = i;
          break;
        }
      }
      if (startCol === -1 || endCol < startCol) continue;
      let row = 0;
      for (;;) {
        if (!occupied[row]) occupied[row] = new Set();
        let free = true;
        for (let c = startCol; c <= endCol; c++) {
          if (occupied[row].has(c)) {
            free = false;
            break;
          }
        }
        if (free) {
          for (let c = startCol; c <= endCol; c++) occupied[row].add(c);
          break;
        }
        row++;
      }
      bars.push({
        key: event.id,
        event,
        left: TIME_COL_WIDTH + startCol * dayWidth + 1,
        top: 3 + row * ALLDAY_ROW_HEIGHT,
        width: (endCol - startCol + 1) * dayWidth - 2,
        row,
      });
    }
    return { timedBlocks: out, allDayBars: bars, allDayRows: occupied.length };
  }, [events, weekDates, dayWidth, countsAsConflict]);

  const nowParts = zonedParts(now);
  const currentTimeTop = ((nowParts.hour * 60 + nowParts.minute) / 60) * HOUR_HEIGHT;
  const pastWidth = todayIdx * dayWidth;
  const futureWidth = (weekDates.length - 1 - todayIdx) * dayWidth;

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
              <Text style={[styles.weekHeaderLabel, { color: isSel ? T.accent : T.textDim }]}>
                {dayLabels[i]}
              </Text>
              <View style={[styles.weekHeaderCircle, isToday && { backgroundColor: T.accent }]}>
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

      {allDayRows > 0 && (
        <View
          style={[
            styles.weekAllDayStrip,
            { borderBottomColor: T.border, height: allDayRows * ALLDAY_ROW_HEIGHT + 6 },
          ]}
        >
          <Text style={[styles.weekAllDayLabel, { color: T.textDim }]}>All day</Text>
          {allDayBars.map((b) => {
            const display = eventDisplayState(b.event);
            return (
              <AllDayEventChip
                key={b.key}
                event={b.event}
                color={colorOf(b.event)}
                live={
                  !!b.event.channelId &&
                  liveChannelIds.has(b.event.channelId) &&
                  !display.cancelled &&
                  !display.detailsHidden
                }
                compact
                style={{
                  position: "absolute",
                  top: b.top,
                  left: b.left,
                  width: b.width,
                  height: ALLDAY_ROW_HEIGHT - 5,
                }}
                onPress={() => onEventPress(b.event.id)}
              />
            );
          })}
        </View>
      )}

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
            // Around the turn of the hour the two labels would print on top of
            // each other; the live one wins.
            const eclipsedByNow = todayIdx >= 0 && Math.abs(top - currentTimeTop) < HOUR_HEIGHT / 4;
            return (
              <React.Fragment key={hour}>
                {eclipsedByNow ? null : (
                  <Text style={[styles.hourLabel, { top: top - 7, color: T.textDim }]}>
                    {formatHourLabel(hour)}
                  </Text>
                )}
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

          {/* The current instant read across the whole week: muted behind it on
              days already spent, accent on today, dashed accent ahead of it.
              Only meaningful on the week that contains today. */}
          {todayIdx >= 0 && (
            <>
              <Text
                style={[styles.currentTimeLabel, { top: currentTimeTop - 7, color: T.accent }]}
                numberOfLines={1}
              >
                {formatClockLabel(now)}
              </Text>

              {pastWidth > 0 && (
                <View
                  style={[
                    styles.weekNowLine,
                    {
                      top: currentTimeTop,
                      left: TIME_COL_WIDTH,
                      width: pastWidth,
                      backgroundColor: T.textDim,
                    },
                  ]}
                />
              )}

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

              {/* SVG rather than a dashed border: a border dashed on one side
                  only renders solid on Android. */}
              {futureWidth > 0 && (
                <Svg
                  style={[
                    styles.weekNowLine,
                    { top: currentTimeTop, left: TIME_COL_WIDTH + (todayIdx + 1) * dayWidth },
                  ]}
                  width={futureWidth}
                  height={2}
                >
                  <Line
                    x1={0}
                    y1={1}
                    x2={futureWidth}
                    y2={1}
                    stroke={T.accent}
                    strokeWidth={2}
                    strokeDasharray="5,4"
                  />
                </Svg>
              )}
            </>
          )}

          {timedBlocks.map((b) => {
            const color = colorOf(b.event);
            const display = eventDisplayState(b.event);
            return (
              <TouchableOpacity
                key={b.key}
                style={[
                  styles.weekEvent,
                  (display.cancelled || display.tentative) && styles.fadedEvent,
                  {
                    top: b.top,
                    left: b.left,
                    width: b.width,
                    height: b.height,
                    backgroundColor: color + (display.free ? "1A" : "33"),
                    borderColor: b.conflict ? T.red : color,
                  },
                ]}
                onPress={() => onEventPress(b.event.id)}
                activeOpacity={0.85}
              >
                {b.event.channelId &&
                liveChannelIds.has(b.event.channelId) &&
                !display.cancelled &&
                !display.detailsHidden ? (
                  <View style={[styles.weekLiveDot, { backgroundColor: T.red }]} />
                ) : null}
                {b.showTitle !== false ? (
                  <Text
                    style={[
                      styles.weekEventText,
                      { color: T.textBright, lineHeight: WEEK_LINE },
                      display.cancelled && styles.struckTitle,
                    ]}
                    // Whole lines only: a second line is offered when the block
                    // has room for one, never squeezed in to be sliced in half.
                    numberOfLines={b.height - WEEK_BORDER - WEEK_PAD_Y * 2 < WEEK_LINE * 2 ? 1 : 2}
                  >
                    {display.title}
                  </Text>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

// The day the display zone's clock is on right now, as a calendar day token.
function zonedTodayToken(timeZone?: string): Date {
  const p = zonedParts(new Date(), timeZone);
  return new Date(p.year, p.month - 1, p.day);
}

// The instant the display zone's clock reads midnight of this day token.
function zonedStartOfDayInstant(token: Date, timeZone?: string): Date {
  return instantFromZonedWall(localDayKey(token), "00:00", timeZone);
}

export function CalendarScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const topPad = (Platform.OS === "web" ? 20 : insets.top) + 6;
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  const { timeZone, weekStartsOn } = useDateTimePrefs();
  const dayLabels = useMemo(() => dayLabelsFrom(weekStartsOn), [weekStartsOn]);
  const today = useMemo(() => zonedTodayToken(timeZone), [timeZone]);
  const [currentMonth, setCurrentMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selectedDate, setSelectedDate] = useState(today);
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [activeCategoryIds, setActiveCategoryIds] = useState<Set<string>>(new Set());
  const [activeTagIds, setActiveTagIds] = useState<Set<string>>(new Set());
  const [focusOnly, setFocusOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [sharedCalendar, setSharedCalendar] = useState<SerializedCalendar | null>(null);
  const dayScrollRef = useRef<ScrollView>(null);
  const tagsQuery = useTags("");
  const activeCalls = useActiveCalls();
  const liveChannelIds = useMemo(() => new Set(Object.keys(activeCalls)), [activeCalls]);
  const updateEvent = useUpdateEvent();
  const [pendingMove, setPendingMove] = useState<((scope: RecurrenceEditScope) => void) | null>(
    null,
  );

  const weekStart = useMemo(
    () => startOfWeek(selectedDate, weekStartsOn),
    [selectedDate, weekStartsOn],
  );
  const weekDates = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  // Range bounds are the display zone's midnights, so events near a day
  // boundary land in the fetched window the grid actually shows.
  const rangeStart = useMemo(() => {
    if (viewMode === "month") {
      return zonedStartOfDayInstant(startOfMonth(currentMonth), timeZone).toISOString();
    }
    if (viewMode === "agenda") {
      return zonedStartOfDayInstant(selectedDate, timeZone).toISOString();
    }
    return zonedStartOfDayInstant(weekStart, timeZone).toISOString();
  }, [viewMode, currentMonth, weekStart, selectedDate, timeZone]);

  const rangeEnd = useMemo(() => {
    if (viewMode === "month") {
      const afterEnd = new Date(endOfMonth(currentMonth));
      afterEnd.setDate(afterEnd.getDate() + 1);
      afterEnd.setHours(0, 0, 0, 0);
      return new Date(zonedStartOfDayInstant(afterEnd, timeZone).getTime() - 1000).toISOString();
    }
    if (viewMode === "agenda") {
      const end = new Date(selectedDate);
      end.setDate(end.getDate() + 30);
      return zonedStartOfDayInstant(end, timeZone).toISOString();
    }
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 7);
    return zonedStartOfDayInstant(end, timeZone).toISOString();
  }, [viewMode, currentMonth, weekStart, selectedDate, timeZone]);

  const eventsQuery = useEventsInRange(rangeStart, rangeEnd);
  const categoriesQuery = useCategories();

  const categoriesMap = useMemo(() => {
    const map = new Map<string, SerializedCategory>();
    categoriesQuery.data?.forEach((c) => map.set(c.id, c));
    return map;
  }, [categoriesQuery.data]);

  const categories = categoriesQuery.data ?? [];

  const calendarsQuery = useCalendars();
  const calendarPolicy = useCalendarPolicy();
  const queryClient = useQueryClient();
  const calendarsById = useMemo(() => {
    const map = new Map<string, SerializedCalendar>();
    calendarsQuery.data?.forEach((c) => map.set(c.id, c));
    return map;
  }, [calendarsQuery.data]);
  const { user } = useAuth();
  const countsAsConflict = useMemo(() => {
    const ownCalendarIds = new Set(
      (calendarsQuery.data ?? []).filter((c) => c.section === "mine").map((c) => c.id),
    );
    const isMine = memberCommitments(user?.id, ownCalendarIds);
    return (event: SerializedEvent) => blocksTime(event) && isMine(event);
  }, [calendarsQuery.data, user?.id]);
  const colorOf = useCallback(
    (event: SerializedEvent) => resolveEventColor(event, calendarsById, categoriesMap, T.accent),
    [calendarsById, categoriesMap, T.accent],
  );

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

  const toggleTag = useCallback((tagId: string) => {
    setActiveTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        next.add(tagId);
      }
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setActiveCategoryIds(new Set());
    setActiveTagIds(new Set());
    setFocusOnly(false);
    setSearchQuery("");
  }, []);

  const matchesFilter = useCallback(
    (event: SerializedEvent) => {
      if (activeCategoryIds.size > 0 && !activeCategoryIds.has(event.categoryId)) return false;
      // Tag filter is logical AND, matching the web calendar's semantics.
      if (activeTagIds.size > 0) {
        const eventTagIds = new Set(event.tags.map((t) => t.id));
        for (const tagId of activeTagIds) {
          if (!eventTagIds.has(tagId)) return false;
        }
      }
      if (focusOnly && !event.isFocusTime) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (
          !event.title.toLowerCase().includes(q) &&
          !event.description.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    },
    [activeCategoryIds, activeTagIds, focusOnly, searchQuery],
  );

  const filtersActive =
    activeCategoryIds.size > 0 || activeTagIds.size > 0 || focusOnly || searchQuery.length > 0;

  const dayEvents = useMemo(() => {
    if (!eventsQuery.data) return [];
    const selectedKey = localDayKey(selectedDate);
    return eventsQuery.data
      .filter((e) => eventCoversDay(e, selectedKey) && matchesFilter(e))
      .sort((a, b) => {
        if (!a.startTime || !b.startTime) return 0;
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      });
  }, [eventsQuery.data, selectedDate, matchesFilter]);

  const dayAllDayEvents = useMemo(() => dayEvents.filter((e) => e.isAllDay), [dayEvents]);

  const { width: windowWidth, fontScale } = useWindowDimensions();

  // Box + side-by-side column placement for each timed event, so overlaps sit
  // next to each other instead of stacking. All-day events live in the pinned
  // strip above the grid - as a full-height column they read as an anonymous
  // stripe with the label parked at midnight, far off-screen.
  const positionedEvents = useMemo(() => {
    const spans = dayEvents
      .filter((e) => !e.isAllDay)
      .map((event) => {
        const startMin = event.startTime ? getMinutesSinceMidnight(event.startTime) : 0;
        let endMin = event.endTime ? getMinutesSinceMidnight(event.endTime) : startMin + 30;
        // Ends at or past midnight (00:00 reads as minute 0) - fill to day bottom.
        if (endMin <= startMin) endMin = HOUR_END * 60;
        return { event, startMin, endMin };
      });
    const placement = packEventColumns(
      spans.map(({ event, startMin, endMin }) => ({ id: event.id, startMin, endMin })),
    );
    // Conflict is a blocking-time signal: cancelled and free events overlap
    // without clashing, so they get geometry but no flag.
    const timedConflict = packEventColumns(
      spans
        .filter(({ event }) => countsAsConflict(event))
        .map(({ event, startMin, endMin }) => ({ id: event.id, startMin, endMin })),
    );
    const areaWidth = windowWidth - (TIME_COL_WIDTH + 4) - 12;
    return spans.map(({ event, startMin, endMin }) => {
      const place = placement.get(event.id) ?? { colIndex: 0, colCount: 1, conflict: false };
      const colWidth = areaWidth / place.colCount;
      return {
        event,
        top: (startMin / 60) * HOUR_HEIGHT,
        height: Math.max(((endMin - startMin) / 60) * HOUR_HEIGHT, minBlockHeight(fontScale)),
        left: TIME_COL_WIDTH + 4 + place.colIndex * colWidth,
        width: colWidth - (place.colCount > 1 ? 3 : 0),
        conflict: timedConflict.get(event.id)?.conflict ?? false,
      };
    });
  }, [dayEvents, windowWidth, fontScale, countsAsConflict]);

  const rangeEvents = useMemo(() => {
    if (!eventsQuery.data) return [];
    return eventsQuery.data.filter(matchesFilter);
  }, [eventsQuery.data, matchesFilter]);

  // Auto-scroll to current time when day view becomes visible
  const hasData = !!eventsQuery.data;
  useEffect(() => {
    if (viewMode === "day" && dayScrollRef.current) {
      const scrollTo = Math.max(0, (zonedParts(new Date()).hour - 1) * HOUR_HEIGHT);
      setTimeout(() => {
        dayScrollRef.current?.scrollTo({ y: scrollTo, animated: false });
      }, 100);
    }
  }, [viewMode, selectedDate, hasData]);

  const selectPeriod = useCallback(
    (item: RailItem) => {
      const unit = railUnitFor(viewMode);
      setSelectedDate(
        resolveRailSelection({
          unit,
          viewMode,
          item,
          current: selectedDate,
          today,
          weekStartsOn,
        }),
      );
      if (unit === "month") {
        setCurrentMonth(new Date(item.date.getFullYear(), item.date.getMonth(), 1));
      }
    },
    [viewMode, selectedDate, today, weekStartsOn],
  );

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
    const todayToken = zonedTodayToken();
    setSelectedDate(todayToken);
    setCurrentMonth(new Date(todayToken.getFullYear(), todayToken.getMonth(), 1));
  }, []);

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
  const [moveDraft, setMoveDraft] = useState<{
    event: SerializedEvent;
    startMin: number;
    durationMin: number;
  } | null>(null);
  const moveAnchorRef = useRef(0);
  const moveDraftRef = useRef<typeof moveDraft>(null);
  // Gesture callbacks fire outside the render cycle; they read the current
  // layout through a ref instead of a stale closure.
  const positionedEventsRef = useRef(positionedEvents);
  useEffect(() => {
    positionedEventsRef.current = positionedEvents;
  }, [positionedEvents]);

  const beginDraft = useCallback((x: number, y: number) => {
    // A long-press landing on an event moves it; only editors get the gesture,
    // and a press on someone else's event does not fall through to drafting a
    // new event underneath it.
    const hit = positionedEventsRef.current.find(
      (p) =>
        !p.event.isAllDay &&
        y >= p.top &&
        y <= p.top + p.height &&
        x >= p.left &&
        x <= p.left + p.width,
    );
    if (hit) {
      if (!roleCanEdit(hit.event.userRole)) return;
      const startMin = getMinutesSinceMidnight(hit.event.startTime);
      let endMin = hit.event.endTime ? getMinutesSinceMidnight(hit.event.endTime) : startMin + 30;
      if (endMin <= startMin) endMin = HOUR_END * 60;
      const draft = { event: hit.event, startMin, durationMin: endMin - startMin };
      moveAnchorRef.current = startMin;
      moveDraftRef.current = draft;
      setMoveDraft(draft);
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      }
      return;
    }
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

  const moveCreateDraft = useCallback((translationY: number) => {
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

  const moveMoveDraft = useCallback((translationY: number) => {
    const current = moveDraftRef.current;
    if (!current) return;
    const deltaMin = Math.round(((translationY / HOUR_HEIGHT) * 60) / SNAP_MINUTES) * SNAP_MINUTES;
    const maxStart = HOUR_END * 60 - current.durationMin;
    const next = Math.min(maxStart, Math.max(0, moveAnchorRef.current + deltaMin));
    if (next !== current.startMin) {
      const updated = { ...current, startMin: next };
      moveDraftRef.current = updated;
      setMoveDraft(updated);
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

  const finishMove = useCallback(
    (commit: boolean) => {
      const draft = moveDraftRef.current;
      moveDraftRef.current = null;
      setMoveDraft(null);
      if (!commit || !draft) return;
      if (draft.startMin === getMinutesSinceMidnight(draft.event.startTime)) return;
      const newStart = instantFromZonedWall(
        localDayKey(selectedDate),
        minutesToHHMM(draft.startMin),
      );
      const newEnd = new Date(newStart.getTime() + draft.durationMin * 60 * 1000);
      // The series' own first date renders under the plain master id, so the
      // split yields no date there - the day on screen is the occurrence.
      const [, suffixDate] = draft.event.id.split(OCCURRENCE_SEPARATOR);
      const occurrenceDate = suffixDate ?? localDayKey(selectedDate);
      const apply = (scope?: RecurrenceEditScope) =>
        updateEvent.mutate(
          {
            eventId: draft.event.id,
            startTime: newStart.toISOString(),
            endTime: newEnd.toISOString(),
            recurrenceEditScope: scope,
            occurrenceDate: scope === undefined ? undefined : occurrenceDate,
          },
          {
            onError: (error) =>
              Alert.alert("Could not move", userFacingError(error, "The event was not moved.")),
          },
        );
      if (draft.event.isRecurring) {
        setPendingMove(() => apply);
      } else {
        apply();
      }
    },
    [selectedDate, updateEvent],
  );

  const endDrag = useCallback(
    (commit: boolean) => {
      if (moveDraftRef.current) finishMove(commit);
      else finishDraft(commit);
    },
    [finishMove, finishDraft],
  );

  const updateDrag = useCallback(
    (translationY: number) => {
      if (moveDraftRef.current) moveMoveDraft(translationY);
      else moveCreateDraft(translationY);
    },
    [moveMoveDraft, moveCreateDraft],
  );

  const dragCreateGesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(300)
        .onStart((e) => {
          runOnJS(beginDraft)(e.x, e.y);
        })
        .onUpdate((e) => {
          runOnJS(updateDrag)(e.translationY);
        })
        .onEnd(() => {
          runOnJS(endDrag)(true);
        })
        .onFinalize(() => {
          // No-op after a committed end (the ref is already cleared); clears
          // the draft when the gesture is cancelled instead of released.
          runOnJS(endDrag)(false);
        }),
    [beginDraft, updateDrag, endDrag],
  );

  // The indicator carries a readable clock, so it has to tick: a stale line is
  // a pixel off and invisible, a stale label is a wrong time.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const nowParts = zonedParts(now);
  const currentTimeTop = ((nowParts.hour * 60 + nowParts.minute) / 60) * HOUR_HEIGHT;
  const isSelectedToday = isSameDay(selectedDate, today);

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: T.bg, borderBottomColor: T.border, paddingTop: topPad },
        ]}
      >
        <Text style={[styles.headerTitle, { color: T.textBright }]}>Calendar</Text>

        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={goToToday}
            hitSlop={HITSLOP}
            accessibilityLabel="Go to today"
          >
            <Target size={21} color={isOnToday ? T.textDim : T.accent} weight="bold" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => setFilterSheetOpen(true)}
            hitSlop={HITSLOP}
            accessibilityLabel="Calendars and filters"
          >
            <Funnel
              size={20}
              color={filtersActive ? T.accent : T.textDim}
              weight={filtersActive ? "fill" : "regular"}
            />
            {filtersActive && (
              <View style={[styles.filterDot, { backgroundColor: T.accent, borderColor: T.bg }]} />
            )}
          </TouchableOpacity>
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
        <View style={[styles.viewToggle, { backgroundColor: T.pageBg, borderColor: T.border }]}>
          {(["day", "week", "month", "agenda"] as ViewMode[]).map((mode) => (
            <TouchableOpacity
              key={mode}
              onPress={() => setView(mode)}
              style={[styles.viewToggleBtn, viewMode === mode && { backgroundColor: T.accent }]}
            >
              <Text
                style={[
                  styles.viewToggleBtnText,
                  { color: viewMode === mode ? "#fff" : T.textDim },
                ]}
              >
                {VIEW_LABELS[mode]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <PeriodRail
        viewMode={viewMode}
        selectedDate={selectedDate}
        currentMonth={currentMonth}
        today={today}
        weekStartsOn={weekStartsOn}
        onSelect={selectPeriod}
      />

      {viewMode === "day" ? (
        <>
          {dayAllDayEvents.length > 0 && (
            <View style={[styles.dayAllDayStrip, { borderBottomColor: T.border }]}>
              {dayAllDayEvents.map((event) => {
                const display = eventDisplayState(event);
                return (
                  <AllDayEventChip
                    key={event.id}
                    event={event}
                    color={colorOf(event)}
                    live={
                      !!event.channelId &&
                      liveChannelIds.has(event.channelId) &&
                      !display.cancelled &&
                      !display.detailsHidden
                    }
                    showAllDayLabel
                    onPress={() => router.push(`/calendar/${event.id}` as any)}
                  />
                );
              })}
            </View>
          )}

          {eventsQuery.isLoading && !eventsQuery.data ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={T.accent} />
            </View>
          ) : (
            <ScrollView
              ref={dayScrollRef}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ height: GRID_HEIGHT + 20 + bottomPad }}
              scrollEnabled={draftStartMin === null && moveDraft === null}
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
                    // Around the turn of the hour the two labels would print on
                    // top of each other; the live one wins.
                    const eclipsedByNow =
                      isSelectedToday && Math.abs(top - currentTimeTop) < HOUR_HEIGHT / 4;
                    return (
                      <React.Fragment key={hour}>
                        {eclipsedByNow ? null : (
                          <Text style={[styles.hourLabel, { top: top - 7, color: T.textDim }]}>
                            {formatHourLabel(hour)}
                          </Text>
                        )}
                        <View style={[styles.hourLine, { top, backgroundColor: T.border }]} />
                      </React.Fragment>
                    );
                  })}

                  {/* Current time indicator */}
                  {isSelectedToday && (
                    <>
                      <Text
                        style={[
                          styles.currentTimeLabel,
                          { top: currentTimeTop - 7, color: T.accent },
                        ]}
                        numberOfLines={1}
                      >
                        {formatClockLabel(now)}
                      </Text>
                      <View style={[styles.currentTimeRow, { top: currentTimeTop - 5 }]}>
                        <View style={[styles.currentTimeDot, { backgroundColor: T.accent }]} />
                        <View style={[styles.currentTimeLine, { backgroundColor: T.accent }]} />
                      </View>
                    </>
                  )}

                  {/* Events positioned on the grid */}
                  {positionedEvents.map(({ event, top, height, left, width, conflict }) => {
                    const color = colorOf(event);
                    const display = eventDisplayState(event);
                    const attendeeLabel = event.attendees.map((a) => a.name).join(", ");
                    const fit = fitBlockText(height, fontScale);
                    const showSecondRow = fit.rows === 2;

                    return (
                      <TouchableOpacity
                        key={event.id}
                        style={[
                          styles.gridEvent,
                          (display.cancelled || display.tentative) && styles.fadedEvent,
                          {
                            top,
                            height,
                            left,
                            width,
                            paddingVertical: fit.padY,
                            backgroundColor: color + (display.free ? "1A" : "33"),
                            borderColor: conflict ? T.red : color,
                          },
                        ]}
                        onPress={() => router.push(`/calendar/${event.id}` as any)}
                        activeOpacity={0.85}
                      >
                        <View style={styles.gridEventRow}>
                          <View style={styles.gridEventTitleWrap}>
                            {conflict ? <Warning size={12} color={T.red} weight="fill" /> : null}
                            {display.outOfOffice ? (
                              <AirplaneTilt size={12} color={T.textDim} weight="duotone" />
                            ) : null}
                            {event.channelId &&
                            liveChannelIds.has(event.channelId) &&
                            !display.cancelled &&
                            !display.detailsHidden ? (
                              <View style={[styles.liveDotSm, { backgroundColor: T.red }]} />
                            ) : null}
                            <Text
                              style={[
                                styles.gridEventTitle,
                                { color: T.textBright, lineHeight: fit.title },
                                display.cancelled && styles.struckTitle,
                              ]}
                              numberOfLines={1}
                            >
                              {display.title}
                            </Text>
                          </View>
                          <Text
                            style={[
                              styles.gridEventTime,
                              { color: T.textBright, lineHeight: fit.title },
                            ]}
                          >
                            {event.startTimeFormatted}
                          </Text>
                        </View>
                        {showSecondRow ? (
                          <View style={styles.gridEventRow}>
                            <Text
                              style={[
                                styles.gridEventDetail,
                                { color: T.textDim, lineHeight: fit.detail },
                              ]}
                              numberOfLines={1}
                            >
                              {attendeeLabel}
                            </Text>
                            <Text
                              style={[
                                styles.gridEventEndTime,
                                { color: T.textDim, lineHeight: fit.detail },
                              ]}
                            >
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

                  {/* Drag-to-move ghost: the picked event riding the finger,
                      times updating live while the original stays in place. */}
                  {moveDraft !== null && (
                    <View
                      pointerEvents="none"
                      style={[
                        styles.gridEvent,
                        styles.draftSlot,
                        {
                          top: (moveDraft.startMin / 60) * HOUR_HEIGHT,
                          left: TIME_COL_WIDTH + 4,
                          right: 12,
                          height: (moveDraft.durationMin / 60) * HOUR_HEIGHT,
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
                          {moveDraft.event.title}
                        </Text>
                        <Text style={[styles.gridEventTime, { color: T.textBright }]}>
                          {minutesToHHMM(moveDraft.startMin)}
                        </Text>
                      </View>
                      <View style={styles.gridEventRow}>
                        <View style={styles.gridEventSpacer} />
                        <Text style={[styles.gridEventEndTime, { color: T.textDim }]}>
                          {minutesToHHMM(moveDraft.startMin + moveDraft.durationMin)}
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
            now={now}
            events={rangeEvents}
            colorOf={colorOf}
            countsAsConflict={countsAsConflict}
            bottomPad={bottomPad}
            onSelectDay={(d) => {
              setSelectedDate(new Date(d));
              setViewMode("day");
            }}
            onEventPress={(id) => router.push(`/calendar/${id}` as any)}
            refreshing={eventsQuery.isFetching && !eventsQuery.isLoading}
            onRefresh={() => eventsQuery.refetch()}
            dayLabels={dayLabels}
            liveChannelIds={liveChannelIds}
          />
        )
      ) : viewMode === "month" ? (
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
                today={today}
                onSelectDate={(d) => {
                  setSelectedDate(d);
                  setCurrentMonth(new Date(d.getFullYear(), d.getMonth(), 1));
                  setViewMode("day");
                }}
                events={rangeEvents}
                colorOf={colorOf}
                countsAsConflict={countsAsConflict}
                weekStartsOn={weekStartsOn}
                dayLabels={dayLabels}
                liveChannelIds={liveChannelIds}
              />
            </ScrollView>
          )}
        </>
      ) : eventsQuery.isLoading && !eventsQuery.data ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      ) : (
        <AgendaList
          events={rangeEvents}
          colorOf={colorOf}
          liveChannelIds={liveChannelIds}
          bottomPad={bottomPad}
          onEventPress={(id) => router.push(`/calendar/${id}` as any)}
          refreshing={eventsQuery.isFetching && !eventsQuery.isLoading}
          onRefresh={() => eventsQuery.refetch()}
        />
      )}

      <CalendarFilterSheet
        visible={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        calendars={calendarsQuery.data ?? []}
        onShareCalendar={(calendar) => {
          setFilterSheetOpen(false);
          setSharedCalendar(calendar);
        }}
        categories={categories}
        activeCategoryIds={activeCategoryIds}
        onToggle={toggleCategory}
        tags={tagsQuery.data ?? []}
        activeTagIds={activeTagIds}
        onToggleTag={toggleTag}
        focusOnly={focusOnly}
        onToggleFocus={() => setFocusOnly((v) => !v)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onClear={clearFilters}
      />

      <ShareSheet
        visible={sharedCalendar !== null}
        onClose={() => {
          setSharedCalendar(null);
          // Leaving a calendar, or opening it to the org, changes this member's list and grid.
          queryClient.invalidateQueries({ queryKey: ["calendars"] });
          queryClient.invalidateQueries({ queryKey: ["events-range"] });
        }}
        contentType={ContentType.CALENDAR}
        contentId={sharedCalendar?.id ?? ""}
        color={sharedCalendar?.color ?? T.accent}
        // Offer "whole organization" only where the org policy lets this member choose it.
        hiddenModes={
          calendarPolicy.data?.canShareCalendarsOrgWide === false ? ["OPEN_TO_ORG"] : undefined
        }
      />

      <RecurrenceScopeSheet
        visible={pendingMove !== null}
        action="edit"
        accentColor={T.accent}
        busy={updateEvent.isPending}
        onClose={() => setPendingMove(null)}
        onSelect={(scope) => {
          const apply = pendingMove;
          setPendingMove(null);
          apply?.(scope);
        }}
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
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 18, fontFamily: FONT.bold },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  iconBtn: {
    width: 34,
    height: 34,
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
  // The toggle gets its own full-width row: four names next to the period
  // label overflow a 360dp screen, and worse at larger text sizes.
  periodBar: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  periodNav: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  viewToggle: {
    flexDirection: "row",
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  viewToggleBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 7,
  },
  viewToggleBtnText: {
    fontSize: 13,
    fontFamily: FONT.medium,
  },
  monthText: { fontSize: 16, fontFamily: FONT.semibold, flexShrink: 1 },
  weekAllDayStrip: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  weekAllDayLabel: {
    position: "absolute",
    left: 0,
    top: 6,
    width: TIME_COL_WIDTH,
    textAlign: "center",
    fontSize: 9,
    fontFamily: FONT.medium,
  },
  dayAllDayStrip: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 4,
    gap: 4,
  },
  weekHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  weekHeaderCell: { flex: 1, alignItems: "center", gap: 2, paddingVertical: 1 },
  weekHeaderLabel: { fontSize: 10, fontFamily: FONT.medium },
  weekHeaderCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  weekHeaderNum: { fontSize: 13, fontFamily: FONT.semibold },
  weekGridBody: {
    position: "relative",
    marginTop: 6,
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
    marginTop: 6,
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
  // A point smaller than the hour labels it sits between: the widest reading
  // ("12:47 PM") has to clear the 56px time gutter without truncating.
  currentTimeLabel: {
    position: "absolute",
    left: 0,
    width: TIME_COL_WIDTH,
    fontSize: 10,
    fontFamily: FONT.semibold,
    textAlign: "right",
    paddingRight: 8,
    lineHeight: 14,
    zIndex: 21,
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
    overflow: "hidden",
    zIndex: 10,
    // Title/start ride the top edge, participants/end the bottom edge.
    justifyContent: "space-between",
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
  fadedEvent: {
    opacity: 0.65,
  },
  struckTitle: {
    textDecorationLine: "line-through",
  },
  monthConflictDot: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 6,
    height: 6,
    borderRadius: 3,
    zIndex: 5,
  },
  monthLiveDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  weekLiveDot: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  liveDotSm: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
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
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
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
