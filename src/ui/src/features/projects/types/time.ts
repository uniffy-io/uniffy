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
  /** ISO instant the work began, when the entry sits on the day's timeline. */
  startedAt?: string;
  /** Log on behalf of someone else; reviewers and timekeeping admins only. */
  userId?: string;
}

export interface UpdateWorklogInput {
  id: string;
  taskId: string;
  workDate?: string;
  durationMinutes?: number;
  description?: string;
  /** A new start, or null to take the entry off the timeline. */
  startedAt?: string | null;
}

export interface Timer {
  id: string;
  taskId: string;
  projectId: string;
  description: string;
  /** Start of the running segment; null while paused. */
  startedAt: string | null;
  /** Seconds from finished segments; elapsed is this plus the running segment. */
  accumulatedSeconds: number;
  pausedAt: string | null;
  /** Set by the overrun job; stays on the timer once applied. */
  pauseReason: "limit" | null;
  taskTitle: string;
  taskNumber: number;
  projectSlug: string;
}

export interface StartTimerInput {
  taskId: string;
  description?: string;
}

export interface StopTimerInput {
  /** The day to log on; ignored when discarding. */
  workDate?: string;
  description?: string;
  /** Replaces the rounded elapsed value when the person corrects it. */
  durationMinutes?: number;
  discard?: boolean;
}

export interface AggregateRow {
  key: string;
  label: string;
  minutes: number;
  entries: number;
}

export type AggregateGroupBy = "day" | "task" | "user";

export interface ReportQuery {
  projectId: string;
  from: string;
  to: string;
  groupBy: AggregateGroupBy;
}

export interface ProjectReport {
  rows: AggregateRow[];
  totalMinutes: number;
}

export function reportKey(query: ReportQuery): string {
  return `${query.projectId}:${query.from}:${query.to}:${query.groupBy}`;
}

export type TimesheetStatus = "open" | "submitted" | "approved" | "rejected";

export type TimePeriodStatus = "open" | "closed";

/** One person's sheet for one period; id is empty until the first state change creates the row. */
export interface Timesheet {
  id: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  status: TimesheetStatus;
  submittedAt: string | null;
  /** Null on a submitted sheet means the period job submitted it. */
  submittedByUserId: string | null;
  submitComment: string;
  reviewerUserId: string | null;
  reviewedAt: string | null;
  reviewComment: string;
  /** While in the future the sheet's days accept edits again. */
  graceUntil: string | null;
  locked: boolean;
  periodClosed: boolean;
  canReview: boolean;
  totalMinutes: number;
  requiredMinutes: number;
  /** The reviewer the person sent the sheet to; null means every reviewer was told. */
  submittedToUserId: string | null;
  /** Who may review the sheet, manager first; only on the person's own sheet. */
  reviewerUserIds: string[];
}

export interface DayTotal {
  day: string;
  minutes: number;
  requiredMinutes: number;
  /** A holiday or an out-of-office day; requiredMinutes already reflects it, half for a half day. */
  off: boolean;
}

/** A person's entries over a range plus what each day asks of them. */
export interface UserWeek {
  worklogs: Worklog[];
  days: DayTotal[];
}

export interface MemberCapacity {
  userId: string;
  /** Required minutes over the person's workdays inside the sprint dates, less days off. */
  capacityMinutes: number;
  estimatedMinutes: number;
  loggedMinutes: number;
}

export interface SprintCapacity {
  rows: MemberCapacity[];
  capacityMinutes: number;
  estimatedMinutes: number;
  loggedMinutes: number;
}

export interface InternalProjectResult {
  projectId: string;
  slug: string;
  created: boolean;
  policy: TimePolicy;
}

export interface TimePeriod {
  id: string;
  startDate: string;
  endDate: string;
  status: TimePeriodStatus;
  closedByUserId: string | null;
  closedAt: string | null;
}

export interface ReviewRow {
  userId: string;
  status: TimesheetStatus;
  periodMinutes: number;
  requiredMinutes: number;
  days: DayTotal[];
  timesheet: Timesheet;
}

export interface ReviewQuery {
  /** Any day inside the period. */
  periodStart: string;
  status?: TimesheetStatus;
  query?: string;
  teamId?: string;
  pageToken?: string;
}

export interface ReviewPage {
  rows: ReviewRow[];
  nextPageToken: string;
  period: TimePeriod;
  viewerIsTimekeepingAdmin: boolean;
}

/** A calendar event inside a loaded week, the material for a suggested entry. */
export interface WeekEvent {
  id: string;
  title: string;
  /** ISO instants. */
  startTime: string;
  endTime: string;
  allDay: boolean;
  outOfOffice: boolean;
  focusTime: boolean;
  cancelled: boolean;
  /** Free in free/busy terms; nobody sat in a meeting. */
  transparent: boolean;
  /** Attendees who did not decline; the organizer is among them. */
  participantIds: string[];
}
