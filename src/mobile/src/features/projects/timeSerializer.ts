import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  TimerPauseReason,
  WorklogSource,
  type DayTotal,
  type TimePolicy,
  type Timer,
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
  weekStart: string;
  approvalsEnabled: boolean;
  requiredMinutesPerDay: number;
  internalProjectId: string | null;
}

export function timePolicyToPlain(policy: TimePolicy): SerializedTimePolicy {
  return {
    enabled: policy.enabled,
    weekStart: policy.weekStart,
    approvalsEnabled: policy.approvalsEnabled,
    requiredMinutesPerDay: policy.requiredMinutesPerDay,
    internalProjectId: policy.internalProjectId ?? null,
  };
}
