import type {
  SerializedTimesheet,
  SerializedTimesheetStatus,
} from "@features/projects/timeSerializer";
import { formatDayRange } from "@features/projects/timeWeek";

export const STATUS_LABEL: Record<SerializedTimesheetStatus, string> = {
  open: "Open",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

export type SheetTone = "default" | "info" | "success" | "warning" | "danger";

const STATUS_TONE: Record<SerializedTimesheetStatus, SheetTone> = {
  open: "default",
  submitted: "info",
  approved: "success",
  rejected: "danger",
};

/** The chip a sheet shows: a closed period or an open sheet past its lock date reads as such. */
export function statusLook(
  status: SerializedTimesheetStatus,
  locked: boolean,
  periodClosed: boolean,
): { label: string; tone: SheetTone } {
  if (periodClosed) return { label: "Closed", tone: "default" };
  if (locked && status === "open") return { label: "Locked", tone: "warning" };
  return { label: STATUS_LABEL[status], tone: STATUS_TONE[status] };
}

export function periodLabel(sheet: Pick<SerializedTimesheet, "periodStart" | "periodEnd">): string {
  return formatDayRange(sheet.periodStart, sheet.periodEnd);
}

export function graceActive(sheet: SerializedTimesheet, now: number = Date.now()): boolean {
  return sheet.graceUntil !== null && Date.parse(sheet.graceUntil) > now;
}

/** The sheet whose period holds `day`, among those loaded for the week. */
export function sheetFor(
  sheets: readonly (SerializedTimesheet | undefined)[],
  day: string,
): SerializedTimesheet | undefined {
  return sheets.find((sheet) => sheet && sheet.periodStart <= day && sheet.periodEnd >= day);
}

/** Why the day refuses writes, or undefined while it accepts them. */
export function lockHint(sheet: SerializedTimesheet | undefined): string | undefined {
  if (!sheet?.locked) return undefined;
  if (sheet.periodClosed) return "This period is closed.";
  if (sheet.status === "submitted") return "Submitted for review; recall it to edit.";
  if (sheet.status === "approved") return "Approved; ask your reviewer to reopen it.";
  return "This period has locked; ask your reviewer to reopen it.";
}

export function canSubmit(sheet: SerializedTimesheet, now: number = Date.now()): boolean {
  return (
    !sheet.periodClosed &&
    (sheet.status === "open" || sheet.status === "rejected") &&
    (!sheet.locked || graceActive(sheet, now))
  );
}

export function canRecall(sheet: SerializedTimesheet): boolean {
  return !sheet.periodClosed && sheet.status === "submitted";
}

/** A reviewer's comment ends a sentence before the next one starts. */
function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function hoursLeft(iso: string, now: number): string {
  const hours = Math.max(1, Math.round((Date.parse(iso) - now) / 3_600_000));
  return hours < 48 ? `for ${hours}h more` : `until ${shortDate(iso)}`;
}

/** "for 5h more" or "until Nov 3" while grace runs; null otherwise. */
export function graceLeft(sheet: SerializedTimesheet, now: number = Date.now()): string | null {
  return graceActive(sheet, now) && sheet.graceUntil ? hoursLeft(sheet.graceUntil, now) : null;
}

/** The state chip and the sentence under it, as the web's period status words them. */
export function sheetSummary(
  sheet: SerializedTimesheet,
  sentToName: string | undefined,
  now: number = Date.now(),
): { label: string; tone: SheetTone; detail: string } {
  const { label, tone } = statusLook(sheet.status, sheet.locked, sheet.periodClosed);
  let detail: string;
  if (sheet.periodClosed) {
    detail = "A timekeeping admin closed this period; entries cannot change.";
  } else if (sheet.status === "approved") {
    detail = sheet.reviewComment
      ? sentence(sheet.reviewComment)
      : "Your reviewer approved this period.";
    if (sheet.locked)
      detail += " Its entries are locked; ask your reviewer for grace to change them.";
  } else if (sheet.status === "submitted") {
    const by = sentToName ? ` by ${sentToName}` : "";
    detail = sheet.submittedAt
      ? `Waiting for review${by} since ${shortDate(sheet.submittedAt)}.`
      : `Waiting for review${by}.`;
  } else if (sheet.status === "rejected") {
    detail = sheet.reviewComment
      ? `Rejected: ${sentence(sheet.reviewComment)}`
      : "Rejected by your reviewer.";
  } else if (sheet.locked) {
    detail = "The period ended and its lock date has passed; ask your reviewer to reopen it.";
  } else {
    detail = "Open. Submit it to your reviewer when the period is done.";
  }
  if (graceActive(sheet, now) && sheet.graceUntil) {
    detail += ` Open for edits ${hoursLeft(sheet.graceUntil, now)}.`;
  }
  return { label, tone, detail };
}
