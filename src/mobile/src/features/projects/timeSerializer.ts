import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  TimePeriodType,
  TimerPauseReason,
  TimesheetStatus,
  WorklogSource,
  type DayTotal,
  type ReviewTimesheetRow,
  type TimePolicy,
  type Timer,
  type Timesheet,
  type Worklog,
} from "@uniffy/proto/projects/v1/time_pb";

export type SerializedWorklogSource = "manual" | "timer" | "import" | "agent";

export interface SerializedWorklog {
  id: string;
  taskId: string;
  projectId: string;
  userId: string;
  createdByUserId: string;
  /** YYYY-MM-DD in the worker's own zone. */
  workDate: string;
  /** When the work began, for an entry placed on the day's clock; null for a day-only entry. */
  startedAt: string | null;
  durationMinutes: number;
  description: string;
  source: SerializedWorklogSource;
  createdAt: string;
}

const SOURCE: Record<WorklogSource, SerializedWorklogSource> = {
  [WorklogSource.UNSPECIFIED]: "manual",
  [WorklogSource.MANUAL]: "manual",
  [WorklogSource.TIMER]: "timer",
  [WorklogSource.IMPORT]: "import",
  [WorklogSource.AGENT]: "agent",
};

export function worklogToPlain(worklog: Worklog): SerializedWorklog {
  return {
    id: worklog.id,
    taskId: worklog.taskId,
    projectId: worklog.projectId,
    userId: worklog.userId,
    createdByUserId: worklog.createdByUserId,
    workDate: worklog.workDate,
    startedAt: worklog.startedAt ? timestampDate(worklog.startedAt).toISOString() : null,
    durationMinutes: worklog.durationMinutes,
    description: worklog.description,
    source: SOURCE[worklog.source] ?? "manual",
    createdAt: worklog.createdAt ? timestampDate(worklog.createdAt).toISOString() : "",
  };
}

export interface SerializedTimer {
  id: string;
  taskId: string;
  projectId: string;
  description: string;
  /** Start of the running segment; null while paused. */
  startedAt: string | null;
  accumulatedSeconds: number;
  pausedAt: string | null;
  pauseReason: "limit" | null;
  taskTitle: string;
  taskNumber: number;
  projectSlug: string;
}

export function timerToPlain(timer: Timer): SerializedTimer {
  return {
    id: timer.id,
    taskId: timer.taskId,
    projectId: timer.projectId,
    description: timer.description,
    startedAt: timer.startedAt ? timestampDate(timer.startedAt).toISOString() : null,
    accumulatedSeconds: timer.accumulatedSeconds,
    pausedAt: timer.pausedAt ? timestampDate(timer.pausedAt).toISOString() : null,
    pauseReason: timer.pauseReason === TimerPauseReason.LIMIT ? "limit" : null,
    taskTitle: timer.taskTitle,
    taskNumber: timer.taskNumber,
    projectSlug: timer.projectSlug,
  };
}

/** Finished segments plus the running one; a clock behind the server never counts backwards. */
export function timerElapsedSeconds(timer: SerializedTimer, nowMs: number): number {
  const running = timer.startedAt ? Math.floor((nowMs - Date.parse(timer.startedAt)) / 1000) : 0;
  return timer.accumulatedSeconds + Math.max(0, running);
}

/** h:mm:ss once an hour is reached, mm:ss before. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** The device's calendar day as YYYY-MM-DD; the server never derives a day from an instant. */
export function localDayKey(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export interface SerializedDayTotal {
  day: string;
  minutes: number;
  requiredMinutes: number;
  /** A holiday or a day away; a half day keeps half the requirement. */
  off: boolean;
}

export function dayTotalToPlain(total: DayTotal): SerializedDayTotal {
  return {
    day: total.day,
    minutes: total.minutes,
    requiredMinutes: total.requiredMinutes,
    off: total.off,
  };
}

export interface SerializedTimePolicy {
  enabled: boolean;
  periodType: "weekly" | "monthly";
  weekStart: string;
  approvalsEnabled: boolean;
  requiredMinutesPerDay: number;
  internalProjectId: string | null;
}

export function timePolicyToPlain(policy: TimePolicy): SerializedTimePolicy {
  return {
    enabled: policy.enabled,
    periodType: policy.periodType === TimePeriodType.MONTHLY ? "monthly" : "weekly",
    weekStart: policy.weekStart,
    approvalsEnabled: policy.approvalsEnabled,
    requiredMinutesPerDay: policy.requiredMinutesPerDay,
    internalProjectId: policy.internalProjectId ?? null,
  };
}

export type SerializedTimesheetStatus = "open" | "submitted" | "approved" | "rejected";

const SHEET_STATUS: Record<TimesheetStatus, SerializedTimesheetStatus> = {
  [TimesheetStatus.UNSPECIFIED]: "open",
  [TimesheetStatus.OPEN]: "open",
  [TimesheetStatus.SUBMITTED]: "submitted",
  [TimesheetStatus.APPROVED]: "approved",
  [TimesheetStatus.REJECTED]: "rejected",
};

export interface SerializedTimesheet {
  id: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  status: SerializedTimesheetStatus;
  submittedAt: string | null;
  submitComment: string;
  reviewComment: string;
  /** While in the future the period's days accept edits again; `locked` already accounts for it. */
  graceUntil: string | null;
  locked: boolean;
  periodClosed: boolean;
  /** The caller reviews this person and is not the person. */
  canReview: boolean;
  totalMinutes: number;
  requiredMinutes: number;
  submittedToUserId: string | null;
  /** Who may review the sheet, manager first. */
  reviewerUserIds: string[];
}

export function timesheetToPlain(sheet: Timesheet): SerializedTimesheet {
  return {
    id: sheet.id,
    userId: sheet.userId,
    periodStart: sheet.periodStart,
    periodEnd: sheet.periodEnd,
    status: SHEET_STATUS[sheet.status] ?? "open",
    submittedAt: sheet.submittedAt ? timestampDate(sheet.submittedAt).toISOString() : null,
    submitComment: sheet.submitComment,
    reviewComment: sheet.reviewComment,
    graceUntil: sheet.graceUntil ? timestampDate(sheet.graceUntil).toISOString() : null,
    locked: sheet.locked,
    periodClosed: sheet.periodClosed,
    canReview: sheet.canReview,
    totalMinutes: sheet.totalMinutes,
    requiredMinutes: sheet.requiredMinutes,
    submittedToUserId: sheet.submittedToUserId ?? null,
    reviewerUserIds: [...sheet.reviewerUserIds],
  };
}

export interface SerializedReviewRow {
  userId: string;
  status: SerializedTimesheetStatus;
  periodMinutes: number;
  requiredMinutes: number;
  /** Absent while the person has no sheet for the period yet. */
  sheet: SerializedTimesheet | null;
}

export function reviewRowToPlain(row: ReviewTimesheetRow): SerializedReviewRow {
  return {
    userId: row.userId,
    status: SHEET_STATUS[row.status] ?? "open",
    periodMinutes: row.periodMinutes,
    requiredMinutes: row.requiredMinutes,
    sheet: row.timesheet ? timesheetToPlain(row.timesheet) : null,
  };
}
