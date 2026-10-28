import { createSelector, createSlice } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import {
  reportKey,
  type DayTotal,
  type ProjectReport,
  type ReviewRow,
  type SprintCapacity,
  type TimePeriod,
  type TimePolicy,
  type Timer,
  type Timesheet,
  type WeekEvent,
  type Worklog,
} from "@/features/projects/types/time";
import {
  approveTimesheet,
  closePeriod,
  createInternalTimeProject,
  createWorklog,
  createWorklogRange,
  deleteWorklog,
  fetchActiveTimer,
  fetchPersonTimesheet,
  fetchPersonWorklogs,
  fetchProjectReport,
  fetchReviewTimesheets,
  fetchReviewEligibility,
  saveTimePolicy,
  fetchSprintCapacity,
  fetchTaskWorklogs,
  fetchTimePolicy,
  fetchTimesheet,
  fetchUserWorklogs,
  fetchWeekEvents,
  grantGrace,
  pauseTimer,
  recallTimesheet,
  rejectTimesheet,
  reopenPeriod,
  resumeTimer,
  startTimer,
  stopTimer,
  submitTimesheet,
  updateWorklog,
} from "@/features/projects/store/timeThunks";

export interface ReviewState {
  rows: ReviewRow[];
  nextPageToken: string;
  period: TimePeriod | null;
  viewerIsTimekeepingAdmin: boolean;
  loading: boolean;
  /** Whether the inbox was ever loaded, so the Approvals tab knows to show. */
  loaded: boolean;
}

export interface TimeState {
  worklogsByTask: Record<string, Worklog[]>;
  loadingByTask: Record<string, boolean>;
  taskPageTokens: Record<string, string>;
  taskRequests: Record<string, string>;
  taskHistoryVersions: Record<string, number>;
  taskLoadedVersions: Record<string, number>;
  taskRequestVersions: Record<string, number>;
  rangeSaving: boolean;
  reviewEligibility: { eligible: boolean; loaded: boolean; loading: boolean };
  policy: TimePolicy | null;
  saving: boolean;
  /** The person's one timer in this organization; null once the first fetch found none. */
  activeTimer: Timer | null;
  timerLoaded: boolean;
  timerBusy: boolean;
  /** The person's own entries per inclusive day range, keyed "from:to". */
  weeks: Record<string, Worklog[]>;
  /** What each day of a loaded range asks of the person, days off included. */
  weekDays: Record<string, DayTotal[]>;
  weekLoading: Record<string, boolean>;
  /** The person's calendar for a loaded range, the source of suggested entries. */
  weekEvents: Record<string, WeekEvent[]>;
  /** The person's own sheets keyed by period start. */
  sheets: Record<string, Timesheet>;
  sheetBusy: boolean;
  review: ReviewState;
  /** Other people's entries, keyed "userId:from:to", and their sheets keyed "userId:periodStart". */
  personWeeks: Record<string, Worklog[]>;
  personWeekDays: Record<string, DayTotal[]>;
  personSheets: Record<string, Timesheet>;
  /** Project aggregates keyed by `reportKey`; a stale report stays while its refresh runs. */
  reports: Record<string, ProjectReport>;
  reportLoading: Record<string, boolean>;
  /** Per sprint: each assignee's capacity against the estimates and the entries. */
  sprintCapacity: Record<string, SprintCapacity>;
}

export const initialTimeState: TimeState = {
  worklogsByTask: {},
  loadingByTask: {},
  taskPageTokens: {},
  taskRequests: {},
  taskHistoryVersions: {},
  taskLoadedVersions: {},
  taskRequestVersions: {},
  rangeSaving: false,
  reviewEligibility: { eligible: false, loaded: false, loading: false },
  policy: null,
  saving: false,
  activeTimer: null,
  timerLoaded: false,
  timerBusy: false,
  weeks: {},
  weekDays: {},
  weekLoading: {},
  weekEvents: {},
  sheets: {},
  sheetBusy: false,
  review: {
    rows: [],
    nextPageToken: "",
    period: null,
    viewerIsTimekeepingAdmin: false,
    loading: false,
    loaded: false,
  },
  personWeeks: {},
  personWeekDays: {},
  personSheets: {},
  reports: {},
  reportLoading: {},
  sprintCapacity: {},
};

function storeSheet(state: TimeState, sheet: Timesheet, ownerId: string | null): void {
  if (ownerId === sheet.userId) state.sheets[sheet.periodStart] = sheet;
  state.personSheets[`${sheet.userId}:${sheet.periodStart}`] = sheet;
  state.review.rows = state.review.rows.map((row) =>
    row.userId === sheet.userId && row.timesheet.periodStart === sheet.periodStart
      ? { ...row, status: sheet.status, timesheet: sheet }
      : row,
  );
}

function applyPeriod(state: TimeState, period: TimePeriod): void {
  const closed = period.status === "closed";
  if (state.review.period?.startDate === period.startDate) state.review.period = period;
  for (const sheet of [
    ...Object.values(state.sheets),
    ...Object.values(state.personSheets),
    ...state.review.rows.map((row) => row.timesheet),
  ]) {
    if (sheet.periodStart === period.startDate) {
      sheet.periodClosed = closed;
      // Reopening may or may not unlock a sheet; the view refetches to find out.
      if (closed) sheet.locked = true;
    }
  }
}

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

function invalidateTaskHistory(state: TimeState, taskId: string): void {
  // Offset cursors shift after inserts, removals and date changes.
  if (state.taskRequests[taskId]) {
    state.taskHistoryVersions[taskId] = (state.taskHistoryVersions[taskId] ?? 0) + 1;
  }
}

function prependEntry(state: TimeState, worklog: Worklog): void {
  invalidateTaskHistory(state, worklog.taskId);
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
        const taskId =
          typeof action.meta.arg === "string" ? action.meta.arg : action.meta.arg.taskId;
        state.loadingByTask[taskId] = true;
        state.taskRequests[taskId] = action.meta.requestId;
        state.taskRequestVersions[taskId] = state.taskHistoryVersions[taskId] ?? 0;
      })
      .addCase(fetchTaskWorklogs.fulfilled, (state, action) => {
        const { taskId, worklogs, nextPageToken = "" } = action.payload;
        if (state.taskRequests[taskId] && state.taskRequests[taskId] !== action.meta.requestId)
          return;
        state.loadingByTask[taskId] = false;
        if ((state.taskRequestVersions[taskId] ?? 0) !== (state.taskHistoryVersions[taskId] ?? 0))
          return;
        state.taskLoadedVersions[taskId] = state.taskHistoryVersions[taskId] ?? 0;
        const replace = action.payload.replace ?? typeof action.meta.arg === "string";
        const previous = replace ? [] : (state.worklogsByTask[taskId] ?? []);
        const byId = new Map([...previous, ...worklogs].map((entry) => [entry.id, entry]));
        state.worklogsByTask[taskId] = sortEntries([...byId.values()]);
        state.taskPageTokens[taskId] = nextPageToken;
      })
      .addCase(fetchTaskWorklogs.rejected, (state, action) => {
        const taskId =
          typeof action.meta.arg === "string" ? action.meta.arg : action.meta.arg.taskId;
        if (state.taskRequests[taskId] !== action.meta.requestId) return;
        state.loadingByTask[taskId] = false;
      })
      .addCase(createWorklogRange.pending, (state) => {
        state.rangeSaving = true;
      })
      .addCase(createWorklogRange.fulfilled, (state) => {
        state.rangeSaving = false;
      })
      .addCase(createWorklogRange.rejected, (state) => {
        state.rangeSaving = false;
      })
      .addCase(createWorklog.pending, (state) => {
        state.saving = true;
      })
      .addCase(createWorklog.fulfilled, (state, action) => {
        state.saving = false;
        const { worklog } = action.payload;
        invalidateTaskHistory(state, worklog.taskId);
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
        invalidateTaskHistory(state, worklog.taskId);
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
        invalidateTaskHistory(state, taskId);
        const current = state.worklogsByTask[taskId];
        if (current) {
          state.worklogsByTask[taskId] = current.filter((entry) => entry.id !== worklogId);
        }
        dropFromWeeks(state, worklogId);
      })
      .addCase(fetchTimePolicy.fulfilled, (state, action) => {
        state.policy = action.payload;
      })
      .addCase(saveTimePolicy.fulfilled, (state, action) => {
        state.policy = action.payload;
      })
      .addCase(fetchReviewEligibility.pending, (state) => {
        state.reviewEligibility.loading = true;
      })
      .addCase(fetchReviewEligibility.fulfilled, (state, action) => {
        state.reviewEligibility = { eligible: action.payload, loaded: true, loading: false };
      })
      .addCase(fetchReviewEligibility.rejected, (state) => {
        state.reviewEligibility.loading = false;
        state.reviewEligibility.loaded = true;
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
        state.weekDays[action.payload.key] = action.payload.days;
      })
      .addCase(fetchUserWorklogs.rejected, (state, action) => {
        const { from, to } = action.meta.arg;
        state.weekLoading[`${from}:${to}`] = false;
      })
      .addCase(fetchWeekEvents.fulfilled, (state, action) => {
        state.weekEvents[action.payload.key] = action.payload.events;
      })
      .addCase(fetchTimesheet.fulfilled, (state, action) => {
        state.sheets[action.payload.periodStart] = action.payload;
      })
      .addCase(submitTimesheet.pending, (state) => {
        state.sheetBusy = true;
      })
      .addCase(submitTimesheet.fulfilled, (state, action) => {
        state.sheetBusy = false;
        state.sheets[action.payload.periodStart] = action.payload;
      })
      .addCase(submitTimesheet.rejected, (state) => {
        state.sheetBusy = false;
      })
      .addCase(recallTimesheet.pending, (state) => {
        state.sheetBusy = true;
      })
      .addCase(recallTimesheet.fulfilled, (state, action) => {
        state.sheetBusy = false;
        state.sheets[action.payload.periodStart] = action.payload;
      })
      .addCase(recallTimesheet.rejected, (state) => {
        state.sheetBusy = false;
      })
      .addCase(fetchReviewTimesheets.pending, (state) => {
        state.review.loading = true;
      })
      .addCase(fetchReviewTimesheets.fulfilled, (state, action) => {
        const { rows, nextPageToken, period, viewerIsTimekeepingAdmin } = action.payload;
        state.review = {
          rows: action.meta.arg.pageToken ? [...state.review.rows, ...rows] : rows,
          nextPageToken,
          period,
          viewerIsTimekeepingAdmin,
          loading: false,
          loaded: true,
        };
      })
      .addCase(fetchReviewTimesheets.rejected, (state) => {
        state.review.loading = false;
      })
      .addCase(fetchProjectReport.pending, (state, action) => {
        state.reportLoading[reportKey(action.meta.arg)] = true;
      })
      .addCase(fetchProjectReport.fulfilled, (state, action) => {
        const key = reportKey(action.meta.arg);
        state.reports[key] = action.payload;
        state.reportLoading[key] = false;
      })
      .addCase(fetchProjectReport.rejected, (state, action) => {
        state.reportLoading[reportKey(action.meta.arg)] = false;
      })
      .addCase(approveTimesheet.fulfilled, (state, action) => {
        storeSheet(state, action.payload, null);
      })
      .addCase(rejectTimesheet.fulfilled, (state, action) => {
        storeSheet(state, action.payload, null);
      })
      .addCase(grantGrace.fulfilled, (state, action) => {
        storeSheet(state, action.payload, null);
      })
      .addCase(closePeriod.fulfilled, (state, action) => {
        applyPeriod(state, action.payload);
      })
      .addCase(reopenPeriod.fulfilled, (state, action) => {
        applyPeriod(state, action.payload);
      })
      .addCase(fetchPersonWorklogs.fulfilled, (state, action) => {
        state.personWeeks[action.payload.key] = sortEntries(action.payload.worklogs);
        state.personWeekDays[action.payload.key] = action.payload.days;
      })
      .addCase(fetchSprintCapacity.fulfilled, (state, action) => {
        state.sprintCapacity[action.payload.sprintId] = action.payload.capacity;
      })
      .addCase(createInternalTimeProject.fulfilled, (state, action) => {
        state.policy = action.payload.policy;
      })
      .addCase(fetchPersonTimesheet.fulfilled, (state, action) => {
        state.personSheets[`${action.payload.userId}:${action.payload.periodStart}`] =
          action.payload;
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

export const selectTimeSaving = (state: RootState) => state.time.saving || state.time.rangeSaving;

export const selectWeekWorklogs = (key: string) =>
  createSelector([selectTimeState], (state) => state.weeks[key] ?? EMPTY);

export const selectWeekLoading = (key: string) => (state: RootState) =>
  state.time.weekLoading[key] ?? false;

const NO_DAYS: DayTotal[] = [];

export const selectWeekDays = (key: string) => (state: RootState) =>
  state.time.weekDays[key] ?? NO_DAYS;

export const selectPersonWeekDays = (key: string) => (state: RootState) =>
  state.time.personWeekDays[key] ?? NO_DAYS;

const NO_EVENTS: WeekEvent[] = [];

export const selectWeekEvents = (key: string) => (state: RootState) =>
  state.time.weekEvents[key] ?? NO_EVENTS;

export const selectSprintCapacity = (sprintId: string) => (state: RootState) =>
  state.time.sprintCapacity[sprintId] ?? null;

export const selectActiveTimer = (state: RootState) => state.time.activeTimer;

export const selectTimerBusy = (state: RootState) => state.time.timerBusy;

const NO_SHEETS: Timesheet[] = [];

/** The person's own sheets whose period touches the inclusive day range. */
export const selectSheetsTouching = (from: string, to: string) =>
  createSelector([selectTimeState], (state) => {
    const sheets = Object.values(state.sheets).filter(
      (sheet) => sheet.periodStart <= to && sheet.periodEnd >= from,
    );
    return sheets.length
      ? sheets.sort((a, b) => a.periodStart.localeCompare(b.periodStart))
      : NO_SHEETS;
  });

export const selectSheetBusy = (state: RootState) => state.time.sheetBusy;

export const selectReviewEligibility = (state: RootState) => state.time.reviewEligibility;

export const selectReview = (state: RootState) => state.time.review;

export const selectPersonWeek = (key: string) =>
  createSelector([selectTimeState], (state) => state.personWeeks[key] ?? EMPTY);

export const selectPersonSheet = (userId: string, periodStart: string) => (state: RootState) =>
  state.time.personSheets[`${userId}:${periodStart}`] ?? null;

export const selectProjectReport = (key: string) => (state: RootState) =>
  state.time.reports[key] ?? null;

export const selectReportLoading = (key: string) => (state: RootState) =>
  state.time.reportLoading[key] ?? false;
