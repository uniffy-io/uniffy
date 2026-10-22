import { createSelector, createSlice } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import type { TimePolicy, Timer, Worklog } from "../types/time";
import {
  createWorklog,
  deleteWorklog,
  fetchActiveTimer,
  fetchTaskWorklogs,
  fetchTimePolicy,
  fetchUserWorklogs,
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
  /** The person's own entries per inclusive day range, keyed "from:to". */
  weeks: Record<string, Worklog[]>;
  weekLoading: Record<string, boolean>;
}

export const initialTimeState: TimeState = {
  worklogsByTask: {},
  loadingByTask: {},
  policy: null,
  saving: false,
  activeTimer: null,
  timerLoaded: false,
  timerBusy: false,
  weeks: {},
  weekLoading: {},
};

/** Every loaded range that covers the entry's day gets it; a range it left drops it. */
function placeInWeeks(state: TimeState, worklog: Worklog): void {
  for (const [key, entries] of Object.entries(state.weeks)) {
    const [from, to] = key.split(":");
    const inside = worklog.workDate >= from && worklog.workDate <= to;
    const rest = entries.filter((entry) => entry.id !== worklog.id);
    state.weeks[key] = inside ? sortEntries([worklog, ...rest]) : rest;
  }
}

function dropFromWeeks(state: TimeState, worklogId: string): void {
  for (const [key, entries] of Object.entries(state.weeks)) {
    state.weeks[key] = entries.filter((entry) => entry.id !== worklogId);
  }
}

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
        // An entry logged for someone else is theirs, not part of this person's week.
        if (!action.meta.arg.userId) placeInWeeks(state, worklog);
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
        if (
          Object.values(state.weeks).some((entries) => entries.some((e) => e.id === worklog.id))
        ) {
          placeInWeeks(state, worklog);
        }
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
        dropFromWeeks(state, worklogId);
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
        if (action.payload.stoppedWorklog) {
          prependEntry(state, action.payload.stoppedWorklog);
          placeInWeeks(state, action.payload.stoppedWorklog);
        }
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
        if (action.payload.worklog) {
          prependEntry(state, action.payload.worklog);
          placeInWeeks(state, action.payload.worklog);
        }
      })
      .addCase(stopTimer.rejected, (state) => {
        state.timerBusy = false;
      })
      .addCase(fetchUserWorklogs.pending, (state, action) => {
        const { from, to } = action.meta.arg;
        state.weekLoading[`${from}:${to}`] = true;
      })
      .addCase(fetchUserWorklogs.fulfilled, (state, action) => {
        state.weekLoading[action.payload.key] = false;
        state.weeks[action.payload.key] = sortEntries(action.payload.worklogs);
      })
      .addCase(fetchUserWorklogs.rejected, (state, action) => {
        const { from, to } = action.meta.arg;
        state.weekLoading[`${from}:${to}`] = false;
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

export const selectWeekWorklogs = (key: string) =>
  createSelector([selectTimeState], (state) => state.weeks[key] ?? EMPTY);

export const selectWeekLoading = (key: string) => (state: RootState) =>
  state.time.weekLoading[key] ?? false;

export const selectActiveTimer = (state: RootState) => state.time.activeTimer;

export const selectTimerBusy = (state: RootState) => state.time.timerBusy;
