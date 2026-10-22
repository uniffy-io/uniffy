import { createSelector, createSlice } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import type { TimePolicy, Timer, Worklog } from "../types/time";
import {
  createWorklog,
  deleteWorklog,
  fetchActiveTimer,
  fetchTaskWorklogs,
  fetchTimePolicy,
  pauseTimer,
  resumeTimer,
  startTimer,
  stopTimer,
  updateWorklog,
} from "./timeThunks";

export interface TimeState {
  worklogsByTask: Record<string, Worklog[]>;
  loadingByTask: Record<string, boolean>;
  policy: TimePolicy | null;
  saving: boolean;
  /** The person's one timer in this organization; null once the first fetch found none. */
  activeTimer: Timer | null;
  timerLoaded: boolean;
  timerBusy: boolean;
}

export const initialTimeState: TimeState = {
  worklogsByTask: {},
  loadingByTask: {},
  policy: null,
  saving: false,
  activeTimer: null,
  timerLoaded: false,
  timerBusy: false,
};

function prependEntry(state: TimeState, worklog: Worklog): void {
  const current = state.worklogsByTask[worklog.taskId];
  if (current) state.worklogsByTask[worklog.taskId] = sortEntries([worklog, ...current]);
}

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
      })
      .addCase(fetchActiveTimer.fulfilled, (state, action) => {
        state.activeTimer = action.payload;
        state.timerLoaded = true;
      })
      .addCase(startTimer.pending, (state) => {
        state.timerBusy = true;
      })
      .addCase(startTimer.fulfilled, (state, action) => {
        state.timerBusy = false;
        state.activeTimer = action.payload.timer;
        state.timerLoaded = true;
        if (action.payload.stoppedWorklog) prependEntry(state, action.payload.stoppedWorklog);
      })
      .addCase(startTimer.rejected, (state) => {
        state.timerBusy = false;
      })
      .addCase(pauseTimer.pending, (state) => {
        state.timerBusy = true;
      })
      .addCase(pauseTimer.fulfilled, (state, action) => {
        state.timerBusy = false;
        state.activeTimer = action.payload;
      })
      .addCase(pauseTimer.rejected, (state) => {
        state.timerBusy = false;
      })
      .addCase(resumeTimer.pending, (state) => {
        state.timerBusy = true;
      })
      .addCase(resumeTimer.fulfilled, (state, action) => {
        state.timerBusy = false;
        state.activeTimer = action.payload;
      })
      .addCase(resumeTimer.rejected, (state) => {
        state.timerBusy = false;
      })
      .addCase(stopTimer.pending, (state) => {
        state.timerBusy = true;
      })
      .addCase(stopTimer.fulfilled, (state, action) => {
        state.timerBusy = false;
        state.activeTimer = null;
        if (action.payload.worklog) prependEntry(state, action.payload.worklog);
      })
      .addCase(stopTimer.rejected, (state) => {
        state.timerBusy = false;
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

export const selectActiveTimer = (state: RootState) => state.time.activeTimer;

export const selectTimerBusy = (state: RootState) => state.time.timerBusy;
