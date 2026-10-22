export type WorklogSource = "manual" | "timer" | "import" | "agent";

export interface Worklog {
  id: string;
  taskId: string;
  projectId: string;
  /** Whose time this is. */
  userId: string;
  /** Who logged it; differs from userId on an on-behalf entry. */
  createdByUserId: string;
  /** YYYY-MM-DD in the worker's own zone. */
  workDate: string;
  startedAt: string | null;
  durationMinutes: number;
  description: string;
  source: WorklogSource;
  createdAt: string;
  updatedAt: string;
}

export type TimePeriodType = "weekly" | "monthly";

export interface TimePolicy {
  organizationId: string;
  enabled: boolean;
  periodType: TimePeriodType;
  weekStart: string;
  monthStartDay: number;
  approvalsEnabled: boolean;
  lockOnSubmit: boolean;
  periodLockDelayDays: number;
  allowLogForOthers: boolean;
  requiredMinutesPerDay: number;
  timerRoundingMinutes: number;
  allowFutureDates: boolean;
  maxDaysBack: number | null;
  maxTimerHours: number;
  autoSubmit: boolean;
  holidays: string[];
  internalProjectId: string | null;
  remindersEnabled: boolean;
  reminderHourUtc: number;
}

export interface CreateWorklogInput {
  taskId: string;
  workDate: string;
  durationMinutes: number;
  description?: string;
  /** Log on behalf of someone else; reviewers and timekeeping admins only. */
  userId?: string;
}

export interface UpdateWorklogInput {
  id: string;
  taskId: string;
  workDate?: string;
  durationMinutes?: number;
  description?: string;
}

export interface AggregateRow {
  key: string;
  label: string;
  minutes: number;
  entries: number;
}
