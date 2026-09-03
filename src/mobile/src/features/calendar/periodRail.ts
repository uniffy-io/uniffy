import type { WeekStartDay } from "@core/datetimePrefs";

export type RailUnit = "day" | "week" | "month";

export interface RailItem {
  key: string;
  /** Day, week start, or month start - the period the pill stands for. */
  date: Date;
  primary: string;
  /** Rollover label drawn before the pill: a month, a year, or both. */
  marker?: string;
  markerWidth: number;
  isToday: boolean;
  /** Marker plus pill plus trailing gap, so the list can lay itself out. */
  width: number;
  offset: number;
}

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MONTH_SHORT = [
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

const MONTH_LONG = [
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

// Half-window per unit: two years of months, half a year of weeks, six weeks of
// days. The rail rebuilds around a new anchor before the reader reaches an end.
const SPAN: Record<RailUnit, number> = { day: 45, week: 26, month: 24 };

// The window is anchored to a stride rather than to the selection, so stepping
// one period keeps the same pills on screen; only crossing a stride boundary
// rebuilds, and the runway left on either side is always SPAN minus STRIDE.
const STRIDE: Record<RailUnit, number> = { day: 15, week: 8, month: 8 };

const PILL_WIDTH: Record<RailUnit, number> = { day: 78, week: 92, month: 68 };
const MARKER_WIDTH = 40;
const MARKER_WIDTH_WITH_YEAR = 68;
const ITEM_GAP = 8;

/**
 * Pill geometry is computed rather than measured: exact offsets are what let
 * the rail centre a period instantly instead of scrolling to a guess. Text
 * scales with the reader's font size, so the widths do too.
 */
export function railWidths(unit: RailUnit, fontScale: number) {
  return {
    pill: Math.round(PILL_WIDTH[unit] * fontScale),
    gap: ITEM_GAP,
  };
}

// A pill names the pinned label only once this much of it shows, so the
// sub-point sliver a fractional offset can leave does not count as leftmost.
const LEADING_MIN_VISIBLE = 4;

/** The pill the pinned label names at a scroll offset: the leftmost one actually showing. */
export function railLeadingItem(items: RailItem[], x: number): RailItem | undefined {
  return items.find((i) => i.offset + i.width - ITEM_GAP - x > LEADING_MIN_VISIBLE) ?? items[0];
}

export function railUnitFor(viewMode: "day" | "week" | "month" | "agenda"): RailUnit {
  if (viewMode === "day") return "day";
  if (viewMode === "week") return "week";
  return "month";
}

function startOfDayToken(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeekToken(date: Date, weekStartsOn: WeekStartDay): Date {
  const d = startOfDayToken(date);
  d.setDate(d.getDate() - ((d.getDay() - weekStartsOn + 7) % 7));
  return d;
}

function startOfMonthToken(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function periodStart(unit: RailUnit, date: Date, weekStartsOn: WeekStartDay): Date {
  if (unit === "day") return startOfDayToken(date);
  if (unit === "week") return startOfWeekToken(date, weekStartsOn);
  return startOfMonthToken(date);
}

/** The key of the period containing a date, so the rail can find it without scanning dates. */
export function railKeyFor(unit: RailUnit, date: Date, weekStartsOn: WeekStartDay): string {
  const start = periodStart(unit, date, weekStartsOn);
  const stamp = `${start.getFullYear()}-${pad2(start.getMonth() + 1)}`;
  if (unit === "month") return stamp;
  const full = `${stamp}-${pad2(start.getDate())}`;
  return unit === "week" ? `W${full}` : full;
}

function shifted(unit: RailUnit, start: Date, steps: number): Date {
  if (unit === "month") return new Date(start.getFullYear(), start.getMonth() + steps, 1);
  const d = new Date(start);
  d.setDate(d.getDate() + steps * (unit === "week" ? 7 : 1));
  return d;
}

/** Ordinal of a period on an absolute axis, for the stride arithmetic below. */
function periodIndex(unit: RailUnit, start: Date): number {
  if (unit === "month") return start.getFullYear() * 12 + start.getMonth();
  const days = Math.floor(
    Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()) / 86_400_000,
  );
  return unit === "week" ? Math.floor(days / 7) : days;
}

/**
 * Key of the window holding a date. It only changes when the selection leaves
 * its stride, which is what keeps the rail from rebuilding on every step - and
 * being a key rather than a Date, it is a complete memo dependency.
 */
export function railAnchorKey(unit: RailUnit, date: Date, weekStartsOn: WeekStartDay): string {
  const start = periodStart(unit, date, weekStartsOn);
  const stride = STRIDE[unit];
  const into = ((periodIndex(unit, start) % stride) + stride) % stride;
  return railKeyFor(unit, shifted(unit, start, -into), weekStartsOn);
}

function dateFromRailKey(key: string): Date {
  const [year, month, day] = key.replace("W", "").split("-").map(Number);
  return new Date(year, month - 1, day ?? 1);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function buildRailItems({
  unit,
  anchorKey,
  today,
  weekStartsOn,
  fontScale,
}: {
  unit: RailUnit;
  anchorKey: string;
  today: Date;
  weekStartsOn: WeekStartDay;
  fontScale: number;
}): RailItem[] {
  const widths = railWidths(unit, fontScale);
  const center = periodStart(unit, dateFromRailKey(anchorKey), weekStartsOn);
  const span = SPAN[unit];
  const items: RailItem[] = [];
  let offset = 0;
  let previousMonth = -1;
  let previousYear = -1;

  for (let step = -span; step <= span; step++) {
    const date = shifted(unit, center, step);
    // A window can span two years, and the pinned year only names its left
    // edge, so a rollover is marked inline: the month where the day and week
    // rails cross one, the year itself where the pills already say the month.
    const yearRolled = date.getFullYear() !== previousYear;
    const monthRolled = date.getMonth() !== previousMonth;
    let marker: string | undefined;
    if (unit === "month") {
      marker = yearRolled ? String(date.getFullYear()) : undefined;
    } else if (monthRolled) {
      marker = yearRolled
        ? `${MONTH_SHORT[date.getMonth()]} ${date.getFullYear()}`
        : MONTH_SHORT[date.getMonth()];
    }
    const markerWidth = marker
      ? Math.round(
          (yearRolled && unit !== "month" ? MARKER_WIDTH_WITH_YEAR : MARKER_WIDTH) * fontScale,
        )
      : 0;
    previousMonth = date.getMonth();
    previousYear = date.getFullYear();

    let primary: string;
    let isToday: boolean;
    if (unit === "day") {
      primary = `${DAY_SHORT[date.getDay()]} · ${date.getDate()}`;
      isToday = sameDay(date, today);
    } else if (unit === "week") {
      const end = new Date(date);
      end.setDate(end.getDate() + 6);
      primary = `${date.getDate()} – ${end.getDate()}`;
      isToday = today >= date && today <= end;
    } else {
      primary = MONTH_SHORT[date.getMonth()];
      isToday = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth();
    }

    items.push({
      key: railKeyFor(unit, date, weekStartsOn),
      date,
      primary,
      marker,
      markerWidth,
      isToday,
      width: widths.pill + widths.gap + markerWidth,
      offset,
    });
    offset += widths.pill + widths.gap + markerWidth;
  }

  return items;
}

/**
 * The label pinned beside the rail, naming what the pills cannot: the month
 * for day and week pills, the year for month pills. A year outside the current
 * one is spelled out, since the pills give no other clue.
 */
export function railPinnedLabel(unit: RailUnit, date: Date, todayYear: number): string {
  if (unit === "month") return String(date.getFullYear());
  const month = MONTH_SHORT[date.getMonth()];
  return date.getFullYear() === todayYear ? month : `${month} ${date.getFullYear()}`;
}

/** The full period name a screen reader announces for a pill. */
export function railAccessibilityLabel(unit: RailUnit, item: RailItem): string {
  const date = item.date;
  if (unit === "day") {
    return `${DAY_SHORT[date.getDay()]} ${date.getDate()} ${MONTH_LONG[date.getMonth()]} ${date.getFullYear()}`;
  }
  if (unit === "week") {
    return `Week of ${date.getDate()} ${MONTH_LONG[date.getMonth()]} ${date.getFullYear()}`;
  }
  return `${MONTH_LONG[date.getMonth()]} ${date.getFullYear()}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * A tap keeps the reader's place inside the period: the same weekday in another
 * week, the same date in another month. The agenda is the exception - it lists
 * forward from one day, so a month means that month from its start.
 */
export function resolveRailSelection({
  unit,
  viewMode,
  item,
  current,
  today,
  weekStartsOn,
}: {
  unit: RailUnit;
  viewMode: "day" | "week" | "month" | "agenda";
  item: RailItem;
  current: Date;
  today: Date;
  weekStartsOn: WeekStartDay;
}): Date {
  if (unit === "day") return new Date(item.date);

  if (unit === "week") {
    const weekday = (current.getDay() - weekStartsOn + 7) % 7;
    const next = new Date(item.date);
    next.setDate(next.getDate() + weekday);
    return next;
  }

  const year = item.date.getFullYear();
  const month = item.date.getMonth();
  if (viewMode === "agenda") {
    const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();
    return isCurrentMonth ? new Date(today) : new Date(year, month, 1);
  }
  return new Date(year, month, Math.min(current.getDate(), daysInMonth(year, month)));
}
