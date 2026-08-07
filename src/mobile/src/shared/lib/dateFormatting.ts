/**
 * Date and time formatting for the whole app. Mirrors the web app's
 * `shared/utils/dateFormatting.ts` so the same instant reads the same on both
 * clients - a note that says "1y ago" on the web must not say "412d ago" here.
 */

/**
 * Reads a plain `YYYY-MM-DD` as a date on the device's calendar.
 *
 * `new Date("2026-08-06")` is specified to parse as UTC midnight, which lands
 * on the previous day everywhere west of Greenwich and shifts day arithmetic by
 * a full day east of it.
 */
export function parseCalendarDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Today on the device's calendar, floored so day arithmetic cannot straddle noon. */
export function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Accepts either a date-only string or a full timestamp. */
function toDate(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseCalendarDate(value) : new Date(value);
}

/** "Jan 22", gaining a year once it is not the current one. */
export function formatDateShort(value: string): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "";
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (date.getFullYear() !== new Date().getFullYear()) options.year = "numeric";
  return date.toLocaleDateString(undefined, options);
}

/** "Jan 22" from a `Date`, never carrying a year. */
export function formatMonthDay(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function relativeFromMs(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** "Just now" / "5m ago" / "3d ago" / "2w ago" / "5mo ago" / "1y ago". */
export function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? "" : relativeFromMs(ms);
}

/** The same ladder, for the proto timestamps that arrive as epoch seconds. */
export function formatRelativeSeconds(seconds: number): string {
  if (!seconds) return "";
  return relativeFromMs(seconds * 1000);
}

/**
 * Compact age with no suffix - "now", "5m", "3d" - for list columns too narrow
 * to carry "ago". Falls back to a short date past a week.
 */
export function formatCompactAge(seconds: number): string {
  if (!seconds) return "";
  const min = Math.floor((Date.now() - seconds * 1000) / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return formatMonthDay(new Date(seconds * 1000));
}
