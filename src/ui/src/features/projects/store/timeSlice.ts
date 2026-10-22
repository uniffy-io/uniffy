import { createSelector, createSlice } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import type { TimePolicy, Worklog } from "../types/time";
import {
  createWorklog,
  deleteWorklog,
  fetchTaskWorklogs,
  fetchTimePolicy,
  updateWorklog,
} from "./timeThunks";

export interface TimeState {
  worklogsByTask: Record<string, Worklog[]>;
  loadingByTask: Record<string, boolean>;
  policy: TimePolicy | null;
  saving: boolean;
}

export const initialTimeState: TimeState = {
  worklogsByTask: {},
  loadingByTask: {},
  policy: null,
  saving: false,
};

function sortEntries(entries: Worklog[]): Worklog[] {
  return [...entries].sort(
    (a, b) => b.workDate.localeCompare(a.workDate) || b.createdAt.localeCompare(a.createdAt),
  );
}

export const timeSlice = createSlice({
  name: "time",
  initialState: initialTimeState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchTaskWorklogs.pending, (state, action) => {
        state.loadingByTask[action.meta.arg] = true;
      })
      .addCase(fetchTaskWorklogs.fulfilled, (state, action) => {
        state.loadingByTask[action.payload.taskId] = false;
        state.worklogsByTask[action.payload.taskId] = sortEntries(action.payload.worklogs);
      })
      .addCase(fetchTaskWorklogs.rejected, (state, action) => {
        state.loadingByTask[action.meta.arg] = false;
      })
      .addCase(createWorklog.pending, (state) => {
        state.saving = true;
      })
      .addCase(createWorklog.fulfilled, (state, action) => {
        state.saving = false;
        const { worklog } = action.payload;
        const current = state.worklogsByTask[worklog.taskId] ?? [];
        state.worklogsByTask[worklog.taskId] = sortEntries([worklog, ...current]);
      })
      .addCase(createWorklog.rejected, (state) => {
        state.saving = false;
      })
      .addCase(updateWorklog.pending, (state) => {
        state.saving = true;
      })
      .addCase(updateWorklog.fulfilled, (state, action) => {
        state.saving = false;
        const { worklog } = action.payload;
        const current = state.worklogsByTask[worklog.taskId] ?? [];
        state.worklogsByTask[worklog.taskId] = sortEntries(
          current.map((entry) => (entry.id === worklog.id ? worklog : entry)),
        );
      })
      .addCase(updateWorklog.rejected, (state) => {
        state.saving = false;
      })
      .addCase(deleteWorklog.fulfilled, (state, action) => {
        const { taskId, worklogId } = action.payload;
        const current = state.worklogsByTask[taskId];
        if (current) {
          state.worklogsByTask[taskId] = current.filter((entry) => entry.id !== worklogId);
        }
      })
      .addCase(fetchTimePolicy.fulfilled, (state, action) => {
        state.policy = action.payload;
      });
  },
});

export const timeReducer = timeSlice.reducer;

const EMPTY: Worklog[] = [];

const selectTimeState = (state: RootState) => state.time;

export const selectWorklogsForTask = (taskId: string) =>
  createSelector([selectTimeState], (state) => state.worklogsByTask[taskId] ?? EMPTY);

export const selectWorklogsLoading = (taskId: string) => (state: RootState) =>
  state.time.loadingByTask[taskId] ?? false;

export const selectTimePolicy = (state: RootState) => state.time.policy;

export const selectTimeSaving = (state: RootState) => state.time.saving;
