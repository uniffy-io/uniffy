import { formatDateShort } from "@/shared/utils/dateFormatting";
import type { Timesheet, TimesheetStatus } from "@/features/projects/types/time";

export type SheetTone = "default" | "info" | "success" | "warning" | "danger";

export const STATUS_LABEL: Record<TimesheetStatus, string> = {
  open: "Open",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

export const STATUS_TONE: Record<TimesheetStatus, SheetTone> = {
  open: "default",
  submitted: "info",
  approved: "success",
  rejected: "danger",
};

export function graceActive(sheet: Timesheet, now: number = Date.now()): boolean {
  return sheet.graceUntil !== null && new Date(sheet.graceUntil).getTime() > now;
}

export function periodLabel(sheet: Pick<Timesheet, "periodStart" | "periodEnd">): string {
  return `${formatDateShort(sheet.periodStart)} to ${formatDateShort(sheet.periodEnd)}`;
}
