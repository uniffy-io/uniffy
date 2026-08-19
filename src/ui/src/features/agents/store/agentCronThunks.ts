import { createAsyncThunk } from "@reduxjs/toolkit";
import { cronApi } from "@/features/agents/api/cronApi";
import type { RootState } from "@/app/store";
import type { CronTaskInfo, CronRunLogInfo } from "@uniffy/proto/agents/v1/cron_pb";

const getOrganizationId = (state: RootState): string => {
  const orgId = state.auth.currentOrganizationId;
  if (!orgId) throw new Error("No organization selected");
  return orgId;
};

const timestampToPlain = (ts?: { seconds: bigint | number; nanos: bigint | number }) => {
  if (!ts) return undefined;
  return {
    seconds: typeof ts.seconds === "bigint" ? Number(ts.seconds) : ts.seconds,
    nanos: typeof ts.nanos === "bigint" ? Number(ts.nanos) : ts.nanos,
  };
};

export const cronTaskToPlain = (task: CronTaskInfo) => ({
  id: task.id,
  organizationId: task.organizationId,
  ownerId: task.ownerId,
  agentId: task.agentId,
  executionUserId: task.executionUserId,
  sessionId: task.sessionId || "",
  name: task.name,
  description: task.description,
  prompt: task.prompt,
  cronExpression: task.cronExpression,
  timezone: task.timezone,
  isEnabled: task.isEnabled,
  lastRunAt: timestampToPlain(task.lastRunAt),
  nextRunAt: timestampToPlain(task.nextRunAt),
  lastRunStatus: task.lastRunStatus || "",
  lastRunError: task.lastRunError || "",
  runCount: task.runCount,
  consecutiveFailures: task.consecutiveFailures,
  maxConsecutiveFailures: task.maxConsecutiveFailures,
  accessMode: task.accessMode,
  baselineRole: task.baselineRole,
  userRole: task.userRole,
  createdAt: timestampToPlain(task.createdAt),
  updatedAt: timestampToPlain(task.updatedAt),
  agentName: task.agentName || "",
});

export type SerializedCronTask = ReturnType<typeof cronTaskToPlain>;

export const cronRunLogToPlain = (log: CronRunLogInfo) => ({
  id: log.id,
  cronTaskId: log.cronTaskId,
  organizationId: log.organizationId,
  sessionId: log.sessionId,
  status: log.status,
  error: log.error || "",
  startedAt: timestampToPlain(log.startedAt),
  completedAt: timestampToPlain(log.completedAt),
  inputTokens: log.inputTokens,
  outputTokens: log.outputTokens,
});

export type SerializedCronRunLog = ReturnType<typeof cronRunLogToPlain>;

export const fetchCronTasks = createAsyncThunk<
  SerializedCronTask[],
  { agentId?: string } | void,
  { state: RootState; rejectValue: string }
>("agentCron/fetchCronTasks", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await cronApi.listCronTasks({
      organizationId,
      agentId: params?.agentId,
      pagination: { page: 1, pageSize: 100 },
    });
    return response.tasks.map(cronTaskToPlain);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch cron tasks");
  }
});

export const createCronTask = createAsyncThunk<
  SerializedCronTask,
  {
    agentId: string;
    name: string;
    prompt: string;
    cronExpression: string;
    timezone?: string;
    description?: string;
    accessMode?: number;
    baselineRole?: number;
  },
  { state: RootState; rejectValue: string }
>("agentCron/createCronTask", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await cronApi.createCronTask({
      organizationId,
      agentId: params.agentId,
      name: params.name,
      prompt: params.prompt,
      cronExpression: params.cronExpression,
      timezone: params.timezone,
      description: params.description,
      accessMode: params.accessMode,
      baselineRole: params.baselineRole,
    });
    if (!response.task) throw new Error("No task returned");
    return cronTaskToPlain(response.task);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to create cron task");
  }
});

export const updateCronTask = createAsyncThunk<
  SerializedCronTask,
  {
    taskId: string;
    name?: string;
    prompt?: string;
    cronExpression?: string;
    timezone?: string;
    description?: string;
    isEnabled?: boolean;
  },
  { state: RootState; rejectValue: string }
>("agentCron/updateCronTask", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const { taskId, ...updates } = params;
    const response = await cronApi.updateCronTask({
      organizationId,
      taskId,
      ...updates,
    });
    if (!response.task) throw new Error("No task returned");
    return cronTaskToPlain(response.task);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to update cron task");
  }
});

export const deleteCronTask = createAsyncThunk<
  string,
  string,
  { state: RootState; rejectValue: string }
>("agentCron/deleteCronTask", async (taskId, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await cronApi.deleteCronTask({ organizationId, taskId });
    return taskId;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to delete cron task");
  }
});

export const triggerCronTask = createAsyncThunk<
  { task: SerializedCronTask; runLog: SerializedCronRunLog },
  string,
  { state: RootState; rejectValue: string }
>("agentCron/triggerCronTask", async (taskId, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await cronApi.triggerCronTask({ organizationId, taskId });
    if (!response.task) throw new Error("No task returned");
    if (!response.runLog) throw new Error("No run log returned");
    return {
      task: cronTaskToPlain(response.task),
      runLog: cronRunLogToPlain(response.runLog),
    };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to trigger cron task");
  }
});

export const fetchCronRunLogs = createAsyncThunk<
  { taskId: string; logs: SerializedCronRunLog[] },
  { taskId: string },
  { state: RootState; rejectValue: string }
>("agentCron/fetchCronRunLogs", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await cronApi.listCronRunLogs({
      organizationId,
      taskId: params.taskId,
      pagination: { page: 1, pageSize: 20 },
    });
    return {
      taskId: params.taskId,
      logs: response.logs.map(cronRunLogToPlain),
    };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch run logs");
  }
});
