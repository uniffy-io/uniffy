import { createAsyncThunk } from "@reduxjs/toolkit";
import type { AppDispatch, RootState } from "@/app/store";
import { timeApi } from "../api/timeApi";
import type { CreateWorklogInput, TimePolicy, UpdateWorklogInput, Worklog } from "../types/time";
import { applyTaskTimeSpent } from "./projectsSlice";
import { fetchActivities } from "./projectsThunks";

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
