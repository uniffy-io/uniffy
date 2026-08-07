/**
 * `Task.recurrenceRule` is not an RRULE - it is the JSON config the server
 * reads in `domains/projects/recurrence.py`.
 *
 * Patterns are stored lower-case because that is what the web selector writes
 * and compares against; the server upper-cases before matching its
 * `RecurrencePattern` enum, so it accepts either. Day names are upper-case
 * because both the web selector and the backend's `DayOfWeek` enum use that.
 */
export type RecurrencePattern = "daily" | "weekly" | "biweekly" | "monthly" | "yearly";

export interface RecurrenceConfig {
  pattern: RecurrencePattern;
  interval: number;
  days_of_week?: string[];
  day_of_month?: number;
  end_date?: string | null;
  max_occurrences?: number | null;
  occurrences_created?: number;
}

export const RECURRENCE_PATTERNS: { value: RecurrencePattern; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

export const DAYS_OF_WEEK: { value: string; short: string }[] = [
  { value: "MONDAY", short: "Mo" },
  { value: "TUESDAY", short: "Tu" },
  { value: "WEDNESDAY", short: "We" },
  { value: "THURSDAY", short: "Th" },
  { value: "FRIDAY", short: "Fr" },
  { value: "SATURDAY", short: "Sa" },
  { value: "SUNDAY", short: "Su" },
];

export function parseRecurrence(rule: string | undefined): RecurrenceConfig | null {
  if (!rule) return null;
  try {
    const parsed = JSON.parse(rule);
    if (!parsed || typeof parsed !== "object" || !parsed.pattern) return null;
    return { ...parsed, pattern: String(parsed.pattern).toLowerCase() as RecurrencePattern };
  } catch {
    return null;
  }
}

export function serializeRecurrence(config: RecurrenceConfig): string {
  // "biweekly" already means every two weeks, so it carries no interval of its
  // own. Normalising on the way out stops a value left over from "weekly" being
  // stored on a rule whose description can never reflect it.
  const normalised = config.pattern === "biweekly" ? { ...config, interval: 2 } : config;
  return JSON.stringify(normalised);
}

function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]}`;
}

export function describeRecurrence(config: RecurrenceConfig): string {
  const { pattern, interval } = config;
  const every = (unit: string) => (interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`);

  let text: string;
  switch (pattern) {
    case "daily":
      text = every("day");
      break;
    case "biweekly":
      text = "Every 2 weeks";
      break;
    case "monthly":
      text = every("month");
      if (config.day_of_month) text += ` on the ${ordinal(config.day_of_month)}`;
      break;
    case "yearly":
      text = every("year");
      break;
    default:
      text = every("week");
      break;
  }

  if ((pattern === "weekly" || pattern === "biweekly") && config.days_of_week?.length) {
    const shorts = config.days_of_week
      .map((day) => DAYS_OF_WEEK.find((d) => d.value === day)?.short)
      .filter(Boolean);
    if (shorts.length > 0) text += ` on ${shorts.join(", ")}`;
  }

  if (config.max_occurrences) text += `, ${config.max_occurrences} times`;
  else if (config.end_date) text += `, until ${config.end_date}`;

  return text;
}

export function defaultRecurrence(): RecurrenceConfig {
  return { pattern: "weekly", interval: 1 };
}
