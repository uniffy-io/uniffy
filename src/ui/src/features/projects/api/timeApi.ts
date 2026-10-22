import { createClient } from "@connectrpc/connect";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { unaryTransport } from "@/config/api";
import { ProjectsService } from "@uniffy/proto/projects/v1/projects_pb";
import {
  TimePeriodType as ProtoTimePeriodType,
  WorklogSource as ProtoWorklogSource,
  type TimePolicy as ProtoTimePolicy,
  type Worklog as ProtoWorklog,
} from "@uniffy/proto/projects/v1/time_pb";
import type {
  CreateWorklogInput,
  TimePeriodType,
  TimePolicy,
  UpdateWorklogInput,
  Worklog,
  WorklogSource,
} from "../types/time";

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

function isoOrEmpty(ts?: { seconds: bigint; nanos: number }): string {
  return ts ? timestampDate(ts).toISOString() : "";
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
  ): Promise<Worklog[]> => {
    const response = await timeClient.listUserWorklogs({
      organizationId,
      ...(userId ? { userId } : {}),
      fromDate,
      toDate,
    });
    return response.worklogs.map(protoWorklogToFrontend);
  },

  getTimePolicy: async (organizationId: string): Promise<TimePolicy> => {
    const response = await timeClient.getTimePolicy({ organizationId });
    return protoPolicyToFrontend(response.policy!);
  },
};
