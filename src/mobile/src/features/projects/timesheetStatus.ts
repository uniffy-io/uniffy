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

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function hoursLeft(iso: string, now: number): string {
  const hours = Math.max(1, Math.round((Date.parse(iso) - now) / 3_600_000));
  return hours < 48 ? `for ${hours}h more` : `until ${shortDate(iso)}`;
}

/** The state chip and the sentence under it, as the web's period status words them. */
export function sheetSummary(
  sheet: SerializedTimesheet,
  sentToName: string | undefined,
  now: number = Date.now(),
): { label: string; tone: SheetTone; detail: string } {
  let label = STATUS_LABEL[sheet.status];
  let tone: SheetTone = (
    { open: "default", submitted: "info", approved: "success", rejected: "danger" } as const
  )[sheet.status];
  let detail: string;
  if (sheet.periodClosed) {
    label = "Closed";
    tone = "default";
    detail = "A timekeeping admin closed this period; entries cannot change.";
  } else if (sheet.status === "approved") {
    detail = sheet.reviewComment || "Your reviewer approved this period.";
    if (sheet.locked)
      detail += " Its entries are locked; ask your reviewer for grace to change them.";
  } else if (sheet.status === "submitted") {
    const by = sentToName ? ` by ${sentToName}` : "";
    detail = sheet.submittedAt
      ? `Waiting for review${by} since ${shortDate(sheet.submittedAt)}.`
      : `Waiting for review${by}.`;
  } else if (sheet.status === "rejected") {
    detail = sheet.reviewComment
      ? `Rejected: ${sheet.reviewComment}`
      : "Rejected by your reviewer.";
  } else if (sheet.locked) {
    label = "Locked";
    tone = "warning";
    detail = "The period ended and its lock date has passed; ask your reviewer to reopen it.";
  } else {
    detail = "Open. Submit it to your reviewer when the period is done.";
  }
  if (graceActive(sheet, now) && sheet.graceUntil) {
    detail += ` Open for edits ${hoursLeft(sheet.graceUntil, now)}.`;
  }
  return { label, tone, detail };
}
