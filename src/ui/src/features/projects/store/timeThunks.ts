import { createAsyncThunk } from "@reduxjs/toolkit";
import type { AppDispatch, RootState } from "@/app/store";
import { effectiveDayKey } from "@/shared/utils/dateFormatting";
import { timeApi } from "../api/timeApi";
import { weekRangeKey } from "../utils/timeWeek";
import type {
  CreateWorklogInput,
  StartTimerInput,
  StopTimerInput,
  TimePolicy,
  Timer,
  UpdateWorklogInput,
  Worklog,
} from "../types/time";
import { applyTaskTimeSpent } from "./projectsSlice";
import { fetchActivities, fetchTask } from "./projectsThunks";

type ThunkConfig = { dispatch: AppDispatch; state: RootState; rejectValue: string };

function organizationIdOf(state: RootState): string | null {
  return state.auth.currentOrganizationId;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export const fetchTaskWorklogs = createAsyncThunk<
  { taskId: string; worklogs: Worklog[] },
  string,
  ThunkConfig
>("time/fetchTaskWorklogs", async (taskId, { getState, rejectWithValue }) => {
  const orgId = organizationIdOf(getState());
  if (!orgId) return rejectWithValue("No organization selected");
  try {
    const worklogs = await timeApi.listTaskWorklogs(taskId, orgId);
    return { taskId, worklogs };
  } catch (error) {
    return rejectWithValue(messageOf(error, "Failed to load time entries"));
  }
});

/** The server returns the task's new rollup with every write; patch it and refresh the activity log. */
function applyRollup(dispatch: AppDispatch, taskId: string, timeSpentMinutes: number): void {
  dispatch(applyTaskTimeSpent({ id: taskId, timeSpentMinutes: timeSpentMinutes || null }));
  dispatch(fetchActivities(taskId));
}

export const createWorklog = createAsyncThunk<
  { worklog: Worklog; taskTimeSpentMinutes: number },
  CreateWorklogInput,
  ThunkConfig
>("time/createWorklog", async (input, { getState, dispatch, rejectWithValue }) => {
  const orgId = organizationIdOf(getState());
  if (!orgId) return rejectWithValue("No organization selected");
  try {
    const result = await timeApi.createWorklog(input, orgId);
    applyRollup(dispatch, input.taskId, result.taskTimeSpentMinutes);
    return result;
  } catch (error) {
    return rejectWithValue(messageOf(error, "Failed to log time"));
  }
});

export const updateWorklog = createAsyncThunk<
  { worklog: Worklog; taskTimeSpentMinutes: number },
  UpdateWorklogInput,
  ThunkConfig
>("time/updateWorklog", async (input, { getState, dispatch, rejectWithValue }) => {
  const orgId = organizationIdOf(getState());
  if (!orgId) return rejectWithValue("No organization selected");
  try {
    const result = await timeApi.updateWorklog(input, orgId);
    applyRollup(dispatch, input.taskId, result.taskTimeSpentMinutes);
    return result;
  } catch (error) {
    return rejectWithValue(messageOf(error, "Failed to update the time entry"));
  }
});

export const deleteWorklog = createAsyncThunk<
  { taskId: string; worklogId: string; taskTimeSpentMinutes: number },
  { worklogId: string; taskId: string },
  ThunkConfig
>("time/deleteWorklog", async ({ worklogId, taskId }, { getState, dispatch, rejectWithValue }) => {
  const orgId = organizationIdOf(getState());
  if (!orgId) return rejectWithValue("No organization selected");
  try {
    const result = await timeApi.deleteWorklog(worklogId, orgId);
    applyRollup(dispatch, taskId, result.taskTimeSpentMinutes);
    return { taskId, worklogId, taskTimeSpentMinutes: result.taskTimeSpentMinutes };
  } catch (error) {
    return rejectWithValue(messageOf(error, "Failed to delete the time entry"));
  }
});

export const fetchTimePolicy = createAsyncThunk<TimePolicy, void, ThunkConfig>(
  "time/fetchTimePolicy",
  async (_, { getState, rejectWithValue }) => {
    const orgId = organizationIdOf(getState());
    if (!orgId) return rejectWithValue("No organization selected");
    try {
      return await timeApi.getTimePolicy(orgId);
    } catch (error) {
      return rejectWithValue(messageOf(error, "Failed to load the time policy"));
    }
  },
);

export const fetchActiveTimer = createAsyncThunk<Timer | null, void, ThunkConfig>(
  "time/fetchActiveTimer",
  async (_, { getState, rejectWithValue }) => {
    const orgId = organizationIdOf(getState());
    if (!orgId) return rejectWithValue("No organization selected");
    try {
      return await timeApi.getActiveTimer(orgId);
    } catch (error) {
      return rejectWithValue(messageOf(error, "Failed to load the timer"));
    }
  },
);

/** A running timer on another task is stopped first; its entry lands on today's day. */
export const startTimer = createAsyncThunk<
  { timer: Timer; stoppedWorklog: Worklog | null },
  StartTimerInput,
  ThunkConfig
>("time/startTimer", async (input, { getState, dispatch, rejectWithValue }) => {
  const orgId = organizationIdOf(getState());
  if (!orgId) return rejectWithValue("No organization selected");
  try {
    const result = await timeApi.startTimer(input, effectiveDayKey(new Date()), orgId);
    if (result.stoppedWorklog) {
      dispatch(fetchTask(result.stoppedWorklog.taskId));
      dispatch(fetchActivities(result.stoppedWorklog.taskId));
    }
    return result;
  } catch (error) {
    return rejectWithValue(messageOf(error, "Failed to start the timer"));
  }
});

export const pauseTimer = createAsyncThunk<Timer, void, ThunkConfig>(
  "time/pauseTimer",
  async (_, { getState, rejectWithValue }) => {
    const orgId = organizationIdOf(getState());
    if (!orgId) return rejectWithValue("No organization selected");
    try {
      return await timeApi.pauseTimer(orgId);
    } catch (error) {
      return rejectWithValue(messageOf(error, "Failed to pause the timer"));
    }
  },
);

export const resumeTimer = createAsyncThunk<Timer, void, ThunkConfig>(
  "time/resumeTimer",
  async (_, { getState, rejectWithValue }) => {
    const orgId = organizationIdOf(getState());
    if (!orgId) return rejectWithValue("No organization selected");
    try {
      return await timeApi.resumeTimer(orgId);
    } catch (error) {
      return rejectWithValue(messageOf(error, "Failed to resume the timer"));
    }
  },
);

export const stopTimer = createAsyncThunk<
  { taskId: string | null; worklog: Worklog | null; taskTimeSpentMinutes: number },
  StopTimerInput,
  ThunkConfig
>("time/stopTimer", async (input, { getState, dispatch, rejectWithValue }) => {
  const state = getState();
  const orgId = organizationIdOf(state);
  if (!orgId) return rejectWithValue("No organization selected");
  const taskId = state.time.activeTimer?.taskId ?? null;
  try {
    const result = await timeApi.stopTimer(input, orgId);
    if (result.worklog) applyRollup(dispatch, result.worklog.taskId, result.taskTimeSpentMinutes);
    return { taskId, ...result };
  } catch (error) {
    return rejectWithValue(messageOf(error, "Failed to stop the timer"));
  }
});

/** The signed-in person's own entries over an inclusive day range, kept under the range key. */
export const fetchUserWorklogs = createAsyncThunk<
  { key: string; worklogs: Worklog[] },
  { from: string; to: string },
  ThunkConfig
>("time/fetchUserWorklogs", async ({ from, to }, { getState, rejectWithValue }) => {
  const orgId = organizationIdOf(getState());
  if (!orgId) return rejectWithValue("No organization selected");
  try {
    const worklogs = await timeApi.listUserWorklogs(orgId, from, to);
    return { key: weekRangeKey(from, to), worklogs };
  } catch (error) {
    return rejectWithValue(messageOf(error, "Failed to load your time"));
  }
});
