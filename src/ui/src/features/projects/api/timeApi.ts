import { createClient } from "@connectrpc/connect";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import { unaryTransport } from "@/config/api";
import { calendarApi } from "@/features/calendar/api/calendarApi";
import {
  AttendeeStatus as ProtoAttendeeStatus,
  EventStatus as ProtoEventStatus,
  EventTransparency as ProtoEventTransparency,
  type CalendarEvent as ProtoCalendarEvent,
} from "@uniffy/proto/cal/v1/calendar_pb";
import { ProjectsService } from "@uniffy/proto/projects/v1/projects_pb";
import {
  AggregateGroupBy as ProtoAggregateGroupBy,
  TimePeriodStatus as ProtoTimePeriodStatus,
  TimePeriodType as ProtoTimePeriodType,
  TimerPauseReason as ProtoTimerPauseReason,
  TimesheetStatus as ProtoTimesheetStatus,
  WorklogSource as ProtoWorklogSource,
  type DayTotal as ProtoDayTotal,
  type ReviewTimesheetRow as ProtoReviewTimesheetRow,
  type TimePeriod as ProtoTimePeriod,
  type TimePolicy as ProtoTimePolicy,
  type Timer as ProtoTimer,
  type Timesheet as ProtoTimesheet,
  type Worklog as ProtoWorklog,
} from "@uniffy/proto/projects/v1/time_pb";
import type {
  AggregateGroupBy,
  CreateWorklogInput,
  DayTotal,
  InternalProjectResult,
  ProjectReport,
  ReportQuery,
  ReviewPage,
  ReviewQuery,
  ReviewRow,
  SprintCapacity,
  StartTimerInput,
  StopTimerInput,
  TimePeriod,
  TimePeriodStatus,
  TimePeriodType,
  TimePolicy,
  Timer,
  Timesheet,
  TimesheetStatus,
  UpdateWorklogInput,
  UserWeek,
  WeekEvent,
  Worklog,
  WorklogSource,
} from "../types/time";

const DAY_MS = 86_400_000;

function protoWeekEventToFrontend(proto: ProtoCalendarEvent): WeekEvent {
  return {
    id: proto.id,
    title: proto.title,
    startTime: proto.startTime ? timestampDate(proto.startTime).toISOString() : "",
    endTime: proto.endTime ? timestampDate(proto.endTime).toISOString() : "",
    allDay: proto.isAllDay,
    outOfOffice: proto.isOutOfOffice,
    focusTime: proto.isFocusTime,
    cancelled: proto.status === ProtoEventStatus.CANCELLED,
    transparent: proto.transparency === ProtoEventTransparency.TRANSPARENT,
    participantIds: proto.attendees
      .filter((attendee) => attendee.status !== ProtoAttendeeStatus.DECLINED)
      .map((attendee) => attendee.id),
  };
}

const timeClient = createClient(ProjectsService, unaryTransport);

const SOURCE_FROM_PROTO: Record<ProtoWorklogSource, WorklogSource> = {
  [ProtoWorklogSource.UNSPECIFIED]: "manual",
  [ProtoWorklogSource.MANUAL]: "manual",
  [ProtoWorklogSource.TIMER]: "timer",
  [ProtoWorklogSource.IMPORT]: "import",
  [ProtoWorklogSource.AGENT]: "agent",
};

const PERIOD_FROM_PROTO: Record<ProtoTimePeriodType, TimePeriodType> = {
  [ProtoTimePeriodType.UNSPECIFIED]: "weekly",
  [ProtoTimePeriodType.WEEKLY]: "weekly",
  [ProtoTimePeriodType.MONTHLY]: "monthly",
};

const PERIOD_TO_PROTO: Record<TimePeriodType, ProtoTimePeriodType> = {
  weekly: ProtoTimePeriodType.WEEKLY,
  monthly: ProtoTimePeriodType.MONTHLY,
};

const SHEET_STATUS_FROM_PROTO: Record<ProtoTimesheetStatus, TimesheetStatus> = {
  [ProtoTimesheetStatus.UNSPECIFIED]: "open",
  [ProtoTimesheetStatus.OPEN]: "open",
  [ProtoTimesheetStatus.SUBMITTED]: "submitted",
  [ProtoTimesheetStatus.APPROVED]: "approved",
  [ProtoTimesheetStatus.REJECTED]: "rejected",
};

const SHEET_STATUS_TO_PROTO: Record<TimesheetStatus, ProtoTimesheetStatus> = {
  open: ProtoTimesheetStatus.OPEN,
  submitted: ProtoTimesheetStatus.SUBMITTED,
  approved: ProtoTimesheetStatus.APPROVED,
  rejected: ProtoTimesheetStatus.REJECTED,
};

const PERIOD_STATUS_FROM_PROTO: Record<ProtoTimePeriodStatus, TimePeriodStatus> = {
  [ProtoTimePeriodStatus.UNSPECIFIED]: "open",
  [ProtoTimePeriodStatus.OPEN]: "open",
  [ProtoTimePeriodStatus.CLOSED]: "closed",
};

const GROUP_BY_TO_PROTO: Record<AggregateGroupBy, ProtoAggregateGroupBy> = {
  day: ProtoAggregateGroupBy.DAY,
  task: ProtoAggregateGroupBy.TASK,
  user: ProtoAggregateGroupBy.USER,
};

function isoOrEmpty(ts?: { seconds: bigint; nanos: number }): string {
  return ts ? timestampDate(ts).toISOString() : "";
}

function isoOrNull(ts?: { seconds: bigint; nanos: number }): string | null {
  return ts ? timestampDate(ts).toISOString() : null;
}

export function protoTimesheetToFrontend(proto: ProtoTimesheet): Timesheet {
  return {
    id: proto.id,
    userId: proto.userId,
    periodStart: proto.periodStart,
    periodEnd: proto.periodEnd,
    status: SHEET_STATUS_FROM_PROTO[proto.status] ?? "open",
    submittedAt: isoOrNull(proto.submittedAt),
    submittedByUserId: proto.submittedByUserId ?? null,
    submitComment: proto.submitComment,
    reviewerUserId: proto.reviewerUserId ?? null,
    reviewedAt: isoOrNull(proto.reviewedAt),
    reviewComment: proto.reviewComment,
    graceUntil: isoOrNull(proto.graceUntil),
    locked: proto.locked,
    periodClosed: proto.periodClosed,
    canReview: proto.canReview,
    totalMinutes: proto.totalMinutes,
    requiredMinutes: proto.requiredMinutes,
  };
}

export function protoPeriodToFrontend(proto: ProtoTimePeriod): TimePeriod {
  return {
    id: proto.id,
    startDate: proto.startDate,
    endDate: proto.endDate,
    status: PERIOD_STATUS_FROM_PROTO[proto.status] ?? "open",
    closedByUserId: proto.closedByUserId ?? null,
    closedAt: isoOrNull(proto.closedAt),
  };
}

function protoDayTotalToFrontend(proto: ProtoDayTotal): DayTotal {
  return {
    day: proto.day,
    minutes: proto.minutes,
    requiredMinutes: proto.requiredMinutes,
    off: proto.off,
  };
}

function protoReviewRowToFrontend(proto: ProtoReviewTimesheetRow): ReviewRow {
  return {
    userId: proto.userId,
    status: SHEET_STATUS_FROM_PROTO[proto.status] ?? "open",
    periodMinutes: proto.periodMinutes,
    requiredMinutes: proto.requiredMinutes,
    days: proto.days.map(protoDayTotalToFrontend),
    timesheet: protoTimesheetToFrontend(proto.timesheet!),
  };
}

export function protoWorklogToFrontend(proto: ProtoWorklog): Worklog {
  return {
    id: proto.id,
    taskId: proto.taskId,
    projectId: proto.projectId,
    userId: proto.userId,
    createdByUserId: proto.createdByUserId,
    workDate: proto.workDate,
    startedAt: proto.startedAt ? timestampDate(proto.startedAt).toISOString() : null,
    durationMinutes: proto.durationMinutes,
    description: proto.description,
    source: SOURCE_FROM_PROTO[proto.source] ?? "manual",
    createdAt: isoOrEmpty(proto.createdAt),
    updatedAt: isoOrEmpty(proto.updatedAt),
  };
}

export function protoTimerToFrontend(proto: ProtoTimer): Timer {
  return {
    id: proto.id,
    taskId: proto.taskId,
    projectId: proto.projectId,
    description: proto.description,
    startedAt: proto.startedAt ? timestampDate(proto.startedAt).toISOString() : null,
    accumulatedSeconds: proto.accumulatedSeconds,
    pausedAt: proto.pausedAt ? timestampDate(proto.pausedAt).toISOString() : null,
    pauseReason: proto.pauseReason === ProtoTimerPauseReason.LIMIT ? "limit" : null,
    taskTitle: proto.taskTitle,
    taskNumber: proto.taskNumber,
    projectSlug: proto.projectSlug,
  };
}

export function protoPolicyToFrontend(proto: ProtoTimePolicy): TimePolicy {
  return {
    organizationId: proto.organizationId,
    enabled: proto.enabled,
    periodType: PERIOD_FROM_PROTO[proto.periodType] ?? "weekly",
    weekStart: proto.weekStart || "monday",
    monthStartDay: proto.monthStartDay,
    approvalsEnabled: proto.approvalsEnabled,
    lockOnSubmit: proto.lockOnSubmit,
    periodLockDelayDays: proto.periodLockDelayDays,
    allowLogForOthers: proto.allowLogForOthers,
    requiredMinutesPerDay: proto.requiredMinutesPerDay,
    timerRoundingMinutes: proto.timerRoundingMinutes,
    allowFutureDates: proto.allowFutureDates,
    maxDaysBack: proto.maxDaysBack ?? null,
    maxTimerHours: proto.maxTimerHours,
    autoSubmit: proto.autoSubmit,
    holidays: [...proto.holidays],
    internalProjectId: proto.internalProjectId ?? null,
    remindersEnabled: proto.remindersEnabled,
    reminderHourUtc: proto.reminderHourUtc,
  };
}

export const timeApi = {
  createWorklog: async (input: CreateWorklogInput, organizationId: string) => {
    const response = await timeClient.createWorklog({
      organizationId,
      taskId: input.taskId,
      ...(input.userId ? { userId: input.userId } : {}),
      workDate: input.workDate,
      durationMinutes: input.durationMinutes,
      description: input.description ?? "",
    });
    return {
      worklog: protoWorklogToFrontend(response.worklog!),
      taskTimeSpentMinutes: response.taskTimeSpentMinutes,
    };
  },

  updateWorklog: async (input: UpdateWorklogInput, organizationId: string) => {
    const response = await timeClient.updateWorklog({
      organizationId,
      worklogId: input.id,
      ...(input.workDate !== undefined ? { workDate: input.workDate } : {}),
      ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    });
    return {
      worklog: protoWorklogToFrontend(response.worklog!),
      taskTimeSpentMinutes: response.taskTimeSpentMinutes,
    };
  },

  deleteWorklog: async (worklogId: string, organizationId: string) => {
    const response = await timeClient.deleteWorklog({ organizationId, worklogId });
    return { taskId: response.taskId, taskTimeSpentMinutes: response.taskTimeSpentMinutes };
  },

  /** Every live entry of a task; the server pages at 200 and caps at 500 per call. */
  listTaskWorklogs: async (taskId: string, organizationId: string): Promise<Worklog[]> => {
    const worklogs: Worklog[] = [];
    let pageToken = "";
    do {
      const response = await timeClient.listTaskWorklogs({
        organizationId,
        taskId,
        pageSize: 500,
        pageToken,
      });
      worklogs.push(...response.worklogs.map(protoWorklogToFrontend));
      pageToken = response.nextPageToken;
    } while (pageToken);
    return worklogs;
  },

  listUserWorklogs: async (
    organizationId: string,
    fromDate: string,
    toDate: string,
    userId?: string,
  ): Promise<UserWeek> => {
    const response = await timeClient.listUserWorklogs({
      organizationId,
      ...(userId ? { userId } : {}),
      fromDate,
      toDate,
    });
    return {
      worklogs: response.worklogs.map(protoWorklogToFrontend),
      days: response.days.map(protoDayTotalToFrontend),
    };
  },

  /** Every visible event touching the days, padded a day each side so any zone's week is covered. */
  listWeekEvents: async (
    organizationId: string,
    fromDate: string,
    toDate: string,
  ): Promise<WeekEvent[]> => {
    const start = new Date(Date.parse(`${fromDate}T00:00:00Z`) - DAY_MS);
    const end = new Date(Date.parse(`${toDate}T00:00:00Z`) + 2 * DAY_MS);
    const response = await calendarApi.getEventsInRange({
      organizationId,
      startDate: timestampFromDate(start),
      endDate: timestampFromDate(end),
    });
    return response.events.map(protoWeekEventToFrontend);
  },

  getSprintCapacity: async (sprintId: string, organizationId: string): Promise<SprintCapacity> => {
    const response = await timeClient.getSprintCapacity({ organizationId, sprintId });
    return {
      rows: response.rows.map((row) => ({
        userId: row.userId,
        capacityMinutes: row.capacityMinutes,
        estimatedMinutes: row.estimatedMinutes,
        loggedMinutes: row.loggedMinutes,
      })),
      capacityMinutes: response.capacityMinutes,
      estimatedMinutes: response.estimatedMinutes,
      loggedMinutes: response.loggedMinutes,
    };
  },

  /** Creates the organization's internal time project once; later calls return it. */
  createInternalTimeProject: async (organizationId: string): Promise<InternalProjectResult> => {
    const response = await timeClient.createInternalTimeProject({ organizationId });
    return {
      projectId: response.projectId,
      slug: response.slug,
      created: response.created,
      policy: protoPolicyToFrontend(response.policy!),
    };
  },

  aggregateWorklogs: async (query: ReportQuery, organizationId: string): Promise<ProjectReport> => {
    const response = await timeClient.aggregateWorklogs({
      organizationId,
      scope: { case: "projectId", value: query.projectId },
      fromDate: query.from,
      toDate: query.to,
      groupBy: GROUP_BY_TO_PROTO[query.groupBy],
    });
    return {
      rows: response.rows.map((row) => ({
        key: row.key,
        label: row.label,
        minutes: row.minutes,
        entries: row.entries,
      })),
      totalMinutes: response.totalMinutes,
    };
  },

  getActiveTimer: async (organizationId: string): Promise<Timer | null> => {
    const response = await timeClient.getActiveTimer({ organizationId });
    return response.timer ? protoTimerToFrontend(response.timer) : null;
  },

  /** workDate is the day a replaced running timer logs on. */
  startTimer: async (input: StartTimerInput, workDate: string, organizationId: string) => {
    const response = await timeClient.startTimer({
      organizationId,
      taskId: input.taskId,
      description: input.description ?? "",
      workDate,
    });
    return {
      timer: protoTimerToFrontend(response.timer!),
      stoppedWorklog: response.stoppedWorklog
        ? protoWorklogToFrontend(response.stoppedWorklog)
        : null,
    };
  },

  pauseTimer: async (organizationId: string): Promise<Timer> => {
    const response = await timeClient.pauseTimer({ organizationId });
    return protoTimerToFrontend(response.timer!);
  },

  resumeTimer: async (organizationId: string): Promise<Timer> => {
    const response = await timeClient.resumeTimer({ organizationId });
    return protoTimerToFrontend(response.timer!);
  },

  stopTimer: async (input: StopTimerInput, organizationId: string) => {
    const response = await timeClient.stopTimer({
      organizationId,
      workDate: input.workDate ?? "",
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
      discard: input.discard ?? false,
    });
    return {
      worklog: response.worklog ? protoWorklogToFrontend(response.worklog) : null,
      taskTimeSpentMinutes: response.taskTimeSpentMinutes,
    };
  },

  getTimePolicy: async (organizationId: string): Promise<TimePolicy> => {
    const response = await timeClient.getTimePolicy({ organizationId });
    return protoPolicyToFrontend(response.policy!);
  },

  updateTimePolicy: async (policy: TimePolicy, organizationId: string): Promise<TimePolicy> => {
    const response = await timeClient.updateTimePolicy({
      organizationId,
      policy: {
        organizationId,
        enabled: policy.enabled,
        periodType: PERIOD_TO_PROTO[policy.periodType],
        weekStart: policy.weekStart,
        monthStartDay: policy.monthStartDay,
        approvalsEnabled: policy.approvalsEnabled,
        lockOnSubmit: policy.lockOnSubmit,
        periodLockDelayDays: policy.periodLockDelayDays,
        allowLogForOthers: policy.allowLogForOthers,
        requiredMinutesPerDay: policy.requiredMinutesPerDay,
        timerRoundingMinutes: policy.timerRoundingMinutes,
        allowFutureDates: policy.allowFutureDates,
        ...(policy.maxDaysBack !== null ? { maxDaysBack: policy.maxDaysBack } : {}),
        maxTimerHours: policy.maxTimerHours,
        autoSubmit: policy.autoSubmit,
        holidays: policy.holidays,
        ...(policy.internalProjectId ? { internalProjectId: policy.internalProjectId } : {}),
        remindersEnabled: policy.remindersEnabled,
        reminderHourUtc: policy.reminderHourUtc,
      },
    });
    return protoPolicyToFrontend(response.policy!);
  },

  /** Any day inside the period works; the server resolves the period containing it. */
  getTimesheet: async (
    day: string,
    organizationId: string,
    userId?: string,
  ): Promise<Timesheet> => {
    const response = await timeClient.getTimesheet({
      organizationId,
      ...(userId ? { userId } : {}),
      periodStart: day,
    });
    return protoTimesheetToFrontend(response.timesheet!);
  },

  submitTimesheet: async (
    day: string,
    comment: string,
    organizationId: string,
    userId?: string,
  ): Promise<Timesheet> => {
    const response = await timeClient.submitTimesheet({
      organizationId,
      ...(userId ? { userId } : {}),
      periodStart: day,
      comment,
    });
    return protoTimesheetToFrontend(response.timesheet!);
  },

  recallTimesheet: async (
    day: string,
    organizationId: string,
    userId?: string,
  ): Promise<Timesheet> => {
    const response = await timeClient.recallTimesheet({
      organizationId,
      ...(userId ? { userId } : {}),
      periodStart: day,
    });
    return protoTimesheetToFrontend(response.timesheet!);
  },

  listReviewTimesheets: async (query: ReviewQuery, organizationId: string): Promise<ReviewPage> => {
    const response = await timeClient.listReviewTimesheets({
      organizationId,
      periodStart: query.periodStart,
      ...(query.status ? { status: SHEET_STATUS_TO_PROTO[query.status] } : {}),
      pageSize: 50,
      pageToken: query.pageToken ?? "",
      query: query.query ?? "",
      ...(query.teamId ? { teamId: query.teamId } : {}),
    });
    return {
      rows: response.rows.map(protoReviewRowToFrontend),
      nextPageToken: response.nextPageToken,
      period: protoPeriodToFrontend(response.period!),
      viewerIsTimekeepingAdmin: response.viewerIsTimekeepingAdmin,
    };
  },

  approveTimesheet: async (
    timesheetId: string,
    comment: string,
    organizationId: string,
  ): Promise<Timesheet> => {
    const response = await timeClient.approveTimesheet({ organizationId, timesheetId, comment });
    return protoTimesheetToFrontend(response.timesheet!);
  },

  rejectTimesheet: async (
    timesheetId: string,
    comment: string,
    organizationId: string,
  ): Promise<Timesheet> => {
    const response = await timeClient.rejectTimesheet({ organizationId, timesheetId, comment });
    return protoTimesheetToFrontend(response.timesheet!);
  },

  grantGrace: async (
    userId: string,
    day: string,
    hours: number,
    organizationId: string,
  ): Promise<Timesheet> => {
    const response = await timeClient.grantGrace({
      organizationId,
      userId,
      periodStart: day,
      hours,
    });
    return protoTimesheetToFrontend(response.timesheet!);
  },

  closePeriod: async (day: string, organizationId: string): Promise<TimePeriod> => {
    const response = await timeClient.closePeriod({ organizationId, periodStart: day });
    return protoPeriodToFrontend(response.period!);
  },

  reopenPeriod: async (day: string, organizationId: string): Promise<TimePeriod> => {
    const response = await timeClient.reopenPeriod({ organizationId, periodStart: day });
    return protoPeriodToFrontend(response.period!);
  },

  listPeriods: async (
    fromDate: string,
    toDate: string,
    organizationId: string,
  ): Promise<TimePeriod[]> => {
    const response = await timeClient.listPeriods({ organizationId, fromDate, toDate });
    return response.periods.map(protoPeriodToFrontend);
  },
};
