import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { Worklog } from "@/features/projects/types/time";
import {
  addDays,
  requiredMinutesOn,
  type RequirementRule,
} from "@/features/projects/utils/timeWeek";

export const SLOT_MINUTES = 30;
export const SNAP_MINUTES = 15;
export const DAY_MINUTES = 1440;
export const MAX_PERIOD_DAYS = 62;

/** "HH:mm" to minutes since midnight. */
export function minutesOfDay(wall: string): number {
  const [hours, minutes] = wall.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Minutes since midnight to "HH:mm"; 1440 reads as "24:00". */
export function wallOf(minutes: number): string {
  const clamped = Math.max(0, Math.min(DAY_MINUTES, minutes));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`;
}

/** The instant a wall-clock time on a day means in the given zone. */
export function instantOf(day: string, wall: string, zone: string): string {
  return fromZonedTime(`${day}T${wall}:00`, zone).toISOString();
}

/** The day and wall-clock time an instant falls on in the given zone. */
export function wallTimeOf(iso: string, zone: string): { day: string; wall: string } {
  const date = new Date(iso);
  return {
    day: formatInTimeZone(date, zone, "yyyy-MM-dd"),
    wall: formatInTimeZone(date, zone, "HH:mm"),
  };
}

export function snapMinutes(minutes: number, step: number = SNAP_MINUTES): number {
  return Math.round(minutes / step) * step;
}

/** Every start of a slot through the day, "00:00" to "23:30". */
export function startSlots(step: number = SLOT_MINUTES): string[] {
  return Array.from({ length: DAY_MINUTES / step }, (_, index) => wallOf(index * step));
}

/** Every end of a slot, "00:30" to "24:00". */
export function endSlots(step: number = SLOT_MINUTES): string[] {
  return Array.from({ length: DAY_MINUTES / step }, (_, index) => wallOf((index + 1) * step));
}

/** The end a start and a length imply, capped at midnight. */
export function endOf(start: string, durationMinutes: number): string {
  return wallOf(minutesOfDay(start) + durationMinutes);
}

/** Days from `from` to `to` inclusive, oldest first; empty when reversed or too long. */
export function daysInRange(from: string, to: string): string[] {
  if (to < from) return [];
  const days: string[] = [];
  let cursor = from;
  while (cursor <= to && days.length <= MAX_PERIOD_DAYS) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days.length > MAX_PERIOD_DAYS ? [] : days;
}

/** The days of a period an entry lands on: every day, or only those that expect hours. */
export function periodDays(
  from: string,
  to: string,
  includeDaysOff: boolean,
  rule: RequirementRule,
): string[] {
  const days = daysInRange(from, to);
  return includeDaysOff ? days : days.filter((day) => requiredMinutesOn(day, rule) > 0);
}

export interface TimelineBlock {
  entry: Worklog;
  /** Minutes since midnight in the viewer's zone. */
  start: number;
  /** Minutes of the day the block covers; an entry past midnight is cut at it. */
  length: number;
}

export interface DayTimeline {
  blocks: TimelineBlock[];
  /** Entries with no start, or whose start falls on another day in this zone. */
  unplaced: Worklog[];
}

/** Where each of a day's entries sits on its timeline. */
export function timelineFor(entries: readonly Worklog[], day: string, zone: string): DayTimeline {
  const blocks: TimelineBlock[] = [];
  const unplaced: Worklog[] = [];
  for (const entry of entries) {
    const placed = entry.startedAt ? wallTimeOf(entry.startedAt, zone) : null;
    if (!placed || placed.day !== day) {
      unplaced.push(entry);
      continue;
    }
    const start = minutesOfDay(placed.wall);
    blocks.push({ entry, start, length: Math.min(entry.durationMinutes, DAY_MINUTES - start) });
  }
  blocks.sort((a, b) => a.start - b.start || a.entry.createdAt.localeCompare(b.entry.createdAt));
  return { blocks, unplaced };
}

/** Columns for blocks that overlap, so two meetings side by side both stay readable. */
export function layoutColumns(
  blocks: readonly TimelineBlock[],
): { column: number; columns: number }[] {
  const placement = blocks.map(() => ({ column: 0, columns: 1 }));
  let clusterStart = 0;
  let clusterEnd = -1;
  const ends: number[] = [];
  blocks.forEach((block, index) => {
    if (block.start >= clusterEnd && index > 0) {
      const width = ends.length;
      for (let i = clusterStart; i < index; i += 1) placement[i].columns = width;
      ends.length = 0;
      clusterStart = index;
    }
    let column = ends.findIndex((end) => end <= block.start);
    if (column === -1) {
      column = ends.length;
      ends.push(0);
    }
    ends[column] = block.start + block.length;
    placement[index].column = column;
    clusterEnd = Math.max(clusterEnd, block.start + block.length);
  });
  for (let i = clusterStart; i < blocks.length; i += 1) placement[i].columns = ends.length;
  return placement;
}
