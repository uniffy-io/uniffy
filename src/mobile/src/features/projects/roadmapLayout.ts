import { parseCalendarDate, startOfToday } from "@shared/lib/dateFormatting";
import type { SerializedTask } from "@features/projects/projectsSerializer";

export type ZoomLevel = "day" | "week" | "month";

export const ZOOM_LEVELS: ZoomLevel[] = ["day", "week", "month"];

/** One column is one period, so the width sets both the grid and the day scale. */
export const COLUMN_WIDTH: Record<ZoomLevel, number> = { day: 40, week: 84, month: 108 };

export const ROW_HEIGHT = 44;
export const LABEL_WIDTH = 116;
export const MONTH_BAND_HEIGHT = 22;
export const PERIOD_BAND_HEIGHT = 26;
export const HEADER_HEIGHT = MONTH_BAND_HEIGHT + PERIOD_BAND_HEIGHT;

/** Enough timeline that a project with two dates a week apart still reads as a timeline. */
const MIN_PERIODS: Record<ZoomLevel, number> = { day: 24, week: 12, month: 8 };
const PAD_PERIODS: Record<ZoomLevel, number> = { day: 2, week: 1, month: 1 };
/**
 * Extra columns past the last date. The grid has to reach the end of the
 * scrollable canvas - a timeline that stops mid-scroll and leaves bare
 * background behind it reads as broken rather than as "the plan ends here".
 */
const TAIL_PERIODS: Record<ZoomLevel, number> = { day: 8, week: 3, month: 2 };
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getFullYear(), date.getMonth() + months, 1);
  return d;
}

/** Day difference on the calendar, immune to the DST hours that break plain subtraction. */
export function diffDays(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / MS_PER_DAY);
}

export function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // Monday-based, matching the web roadmap and the calendar domain.
  const shift = (d.getDay() + 6) % 7;
  return addDays(d, -shift);
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function startOfPeriod(date: Date, zoom: ZoomLevel): Date {
  if (zoom === "day") return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (zoom === "week") return startOfWeek(date);
  return startOfMonth(date);
}

function addPeriods(date: Date, count: number, zoom: ZoomLevel): Date {
  if (zoom === "day") return addDays(date, count);
  if (zoom === "week") return addDays(date, count * 7);
  return addMonths(date, count);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * X of a date on the canvas. Month zoom interpolates within the month rather
 * than assuming 30 days, so a bar ending on the 31st does not overhang.
 */
export function dateToX(date: Date, viewStart: Date, zoom: ZoomLevel): number {
  const columnWidth = COLUMN_WIDTH[zoom];
  if (zoom === "month") {
    const months =
      (date.getFullYear() - viewStart.getFullYear()) * 12 +
      (date.getMonth() - viewStart.getMonth());
    return (months + (date.getDate() - 1) / daysInMonth(date)) * columnWidth;
  }
  const perDay = zoom === "day" ? columnWidth : columnWidth / 7;
  return diffDays(viewStart, date) * perDay;
}

export type TimelineColumn = {
  key: string;
  left: number;
  width: number;
  label: string;
  isWeekend: boolean;
  isToday: boolean;
  startsMonth: boolean;
};

export type MonthBand = { key: string; left: number; width: number; label: string };

export type Timeline = {
  start: Date;
  end: Date;
  width: number;
  columns: TimelineColumn[];
  months: MonthBand[];
  todayX: number;
};

function periodLabel(date: Date, zoom: ZoomLevel): string {
  if (zoom === "day") return String(date.getDate());
  if (zoom === "week")
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return date.toLocaleDateString(undefined, { month: "short" });
}

function monthLabel(date: Date, zoom: ZoomLevel): string {
  return zoom === "month"
    ? String(date.getFullYear())
    : date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/**
 * The window every date in the project fits into, padded and snapped to whole
 * periods, and never shorter than `MIN_PERIODS` so a two-date project still
 * gets a timeline to sit on.
 */
export function buildTimeline(dates: Date[], zoom: ZoomLevel): Timeline {
  const today = startOfToday();
  let earliest = today;
  let latest = today;
  for (const d of dates) {
    if (d < earliest) earliest = d;
    if (d > latest) latest = d;
  }

  const start = addPeriods(startOfPeriod(earliest, zoom), -PAD_PERIODS[zoom], zoom);
  let end = addPeriods(startOfPeriod(latest, zoom), TAIL_PERIODS[zoom] + 1, zoom);

  const columns: TimelineColumn[] = [];
  let cursor = start;
  let index = 0;
  while (cursor < end || columns.length < MIN_PERIODS[zoom]) {
    const next = addPeriods(cursor, 1, zoom);
    const left = dateToX(cursor, start, zoom);
    const dayOfWeek = cursor.getDay();
    columns.push({
      key: `${index}`,
      left,
      width: dateToX(next, start, zoom) - left,
      label: periodLabel(cursor, zoom),
      isWeekend: zoom === "day" && (dayOfWeek === 0 || dayOfWeek === 6),
      isToday: zoom === "day" ? isSameDay(cursor, today) : today >= cursor && today < next,
      startsMonth: cursor.getDate() === 1,
    });
    cursor = next;
    index += 1;
    if (index > 400) break;
  }
  end = cursor;

  const months: MonthBand[] = [];
  for (const column of columns) {
    const last = months[months.length - 1];
    const at = addPeriods(start, Number(column.key), zoom);
    const label = monthLabel(at, zoom);
    if (last && last.label === label) {
      last.width = column.left + column.width - last.left;
    } else {
      months.push({ key: `${column.key}-${label}`, left: column.left, width: column.width, label });
    }
  }

  return {
    start,
    end,
    width: columns.length
      ? columns[columns.length - 1].left + columns[columns.length - 1].width
      : 0,
    columns,
    months,
    todayX: dateToX(today, start, zoom),
  };
}

export type RoadmapRow = {
  task: SerializedTask;
  depth: number;
  hasChildren: boolean;
};

/**
 * Parents followed by their indented descendants, honouring the collapsed set.
 * A task whose parent was filtered out is promoted to a root so nothing is
 * silently dropped from the plan.
 */
export function buildRows(tasks: SerializedTask[], collapsed: Set<string>): RoadmapRow[] {
  const present = new Set(tasks.map((t) => t.id));
  const childrenByParent = new Map<string, SerializedTask[]>();
  for (const task of tasks) {
    if (task.parentId && present.has(task.parentId)) {
      const kids = childrenByParent.get(task.parentId) ?? [];
      kids.push(task);
      childrenByParent.set(task.parentId, kids);
    }
  }

  const rows: RoadmapRow[] = [];
  const visit = (task: SerializedTask, depth: number) => {
    const kids = (childrenByParent.get(task.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder);
    rows.push({ task, depth, hasChildren: kids.length > 0 });
    if (kids.length && !collapsed.has(task.id)) for (const kid of kids) visit(kid, depth + 1);
  };
  for (const task of tasks) {
    if (!task.parentId || !present.has(task.parentId)) visit(task, 0);
  }
  return rows;
}

export type Span = { start: Date; end: Date };

/**
 * For every task with children, the min start / max due across its descendants.
 * Lets a parent that carries no dates of its own still show the bracket its
 * children occupy.
 */
export function computeRollupSpans(tasks: SerializedTask[]): Map<string, Span> {
  const childrenByParent = new Map<string, SerializedTask[]>();
  for (const task of tasks) {
    if (task.parentId) {
      const kids = childrenByParent.get(task.parentId) ?? [];
      kids.push(task);
      childrenByParent.set(task.parentId, kids);
    }
  }

  const spans = new Map<string, Span>();
  const compute = (taskId: string, visiting: Set<string>): Span | null => {
    const cached = spans.get(taskId);
    if (cached) return cached;
    if (visiting.has(taskId)) return null;
    visiting.add(taskId);

    let start: Date | null = null;
    let end: Date | null = null;
    const consider = (from: Date | null, to: Date | null) => {
      if (from && (!start || from < start)) start = from;
      if (to && (!end || to > end)) end = to;
    };

    for (const kid of childrenByParent.get(taskId) ?? []) {
      consider(
        kid.startDate ? parseCalendarDate(kid.startDate) : null,
        kid.dueDate ? parseCalendarDate(kid.dueDate) : null,
      );
      const sub = compute(kid.id, visiting);
      if (sub) consider(sub.start, sub.end);
    }

    visiting.delete(taskId);
    if (start && end) {
      const span: Span = { start, end };
      spans.set(taskId, span);
      return span;
    }
    return null;
  };

  for (const taskId of childrenByParent.keys()) compute(taskId, new Set());
  return spans;
}

export type BarKind = "milestone" | "range" | "due" | "start" | "rollup";

export type TaskBar = { kind: BarKind; start: Date; end: Date };

/**
 * What a task draws on the timeline, or null when it carries no dates at all -
 * those tasks belong in the unscheduled list rather than in an empty row.
 */
export function taskBar(task: SerializedTask, rollup: Map<string, Span>): TaskBar | null {
  const start = task.startDate ? parseCalendarDate(task.startDate) : null;
  const due = task.dueDate ? parseCalendarDate(task.dueDate) : null;

  if (task.isMilestone && (due || start)) {
    const at = (due ?? start)!;
    return { kind: "milestone", start: at, end: at };
  }
  if (start && due) return { kind: "range", start, end: due < start ? start : due };
  if (due) return { kind: "due", start: due, end: due };
  if (start) return { kind: "start", start, end: start };

  const span = rollup.get(task.id);
  return span ? { kind: "rollup", start: span.start, end: span.end } : null;
}

export type BarGeometry = { left: number; width: number };

/** Orthogonal blocker connector: a stub out of the blocker, then across and into the blocked bar. */
export function dependencyPath(sx: number, sy: number, ex: number, ey: number): string {
  const stub = 14;
  const radius = 6;
  if (sy === ey) return `M ${sx} ${sy} L ${ex} ${ey}`;

  const down = ey > sy;
  if (ex - sx > stub * 2) {
    const turn = sx + stub;
    const r = Math.min(radius, stub, Math.abs(ey - sy) / 2);
    const ry = down ? r : -r;
    return [
      `M ${sx} ${sy}`,
      `L ${turn - r} ${sy}`,
      `Q ${turn} ${sy}, ${turn} ${sy + ry}`,
      `L ${turn} ${ey - ry}`,
      `Q ${turn} ${ey}, ${turn + r} ${ey}`,
      `L ${ex} ${ey}`,
    ].join(" ");
  }

  // The blocked task starts at or before its blocker's end, so the line has to
  // double back through the gap between the two rows.
  const out = sx + stub;
  const midY = (sy + ey) / 2;
  const enter = ex - stub;
  const r = Math.min(radius, Math.abs(midY - sy) / 2, Math.abs(enter - out) / 2 || radius);
  const ry = down ? r : -r;
  const rx = enter < out ? -r : r;
  return [
    `M ${sx} ${sy}`,
    `L ${out - r} ${sy}`,
    `Q ${out} ${sy}, ${out} ${sy + ry}`,
    `L ${out} ${midY - ry}`,
    `Q ${out} ${midY}, ${out + rx} ${midY}`,
    `L ${enter - rx} ${midY}`,
    `Q ${enter} ${midY}, ${enter} ${midY + ry}`,
    `L ${enter} ${ey - ry}`,
    `Q ${enter} ${ey}, ${enter + r} ${ey}`,
    `L ${ex} ${ey}`,
  ].join(" ");
}

/** Half-open on the right: a bar covers its due date, so it ends at due + 1. */
export function barGeometry(bar: TaskBar, viewStart: Date, zoom: ZoomLevel): BarGeometry {
  const left = dateToX(bar.start, viewStart, zoom);
  const right = dateToX(addDays(bar.end, 1), viewStart, zoom);
  return { left, width: Math.max(right - left, zoom === "day" ? 24 : 14) };
}

/** "3 Aug", "3 - 12 Aug", "24 Aug - 4 Sep" - the month is only repeated when it changes. */
export function formatSpan(start: Date, end: Date): string {
  const day = (d: Date) => String(d.getDate());
  const monthDay = (d: Date) =>
    `${d.getDate()} ${d.toLocaleDateString(undefined, { month: "short" })}`;
  if (start.getTime() === end.getTime()) return monthDay(start);
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${day(start)} - ${monthDay(end)}`;
  }
  return `${monthDay(start)} - ${monthDay(end)}`;
}

export function isOverdue(task: SerializedTask): boolean {
  if (!task.dueDate || task.completedAt) return false;
  return parseCalendarDate(task.dueDate) < startOfToday();
}
