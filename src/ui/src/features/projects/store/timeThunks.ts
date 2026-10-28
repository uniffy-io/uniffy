import { createAsyncThunk } from "@reduxjs/toolkit";
import type { AppDispatch, RootState } from "@/app/store";
import { effectiveDayKey } from "@/shared/utils/dateFormatting";
import { timeApi } from "@/features/projects/api/timeApi";
import { instantOf } from "@/features/projects/utils/timeClock";
import { weekRangeKey } from "@/features/projects/utils/timeWeek";
import type {
  CreateWorklogInput,
  InternalProjectResult,
  ProjectReport,
  ReportQuery,
  ReviewPage,
  ReviewQuery,
  SprintCapacity,
  StartTimerInput,
  StopTimerInput,
  TimePeriod,
  TimePolicy,
  Timer,
  Timesheet,
  UpdateWorklogInput,
  UserWeek,
  WeekEvent,
  Worklog,
} from "@/features/projects/types/time";
import { applyTaskTimeSpent } from "@/features/projects/store/projectsSlice";
import { fetchActivities, fetchTask } from "@/features/projects/store/projectsThunks";

type ThunkConfig = { dispatch: AppDispatch; state: RootState; rejectValue: string };

function organizationIdOf(state: RootState): string | null {
  return state.auth.currentOrganizationId;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export const fetchTaskWorklogs = createAsyncThunk<
  { taskId: string; worklogs: Worklog[]; nextPageToken?: string; replace?: boolean },
  string | { taskId: string; pageToken: string },
  ThunkConfig
>("time/fetchTaskWorklogs", async (input, { getState, rejectWithValue }) => {
  const taskId = typeof input === "string" ? input : input.taskId;
  const state = getState();
  const stale =
    (state.time.taskHistoryVersions[taskId] ?? 0) !== (state.time.taskLoadedVersions[taskId] ?? 0);
  const pageToken = typeof input === "string" || stale ? "" : input.pageToken;
  const orgId = organizationIdOf(state);
  if (!orgId) return rejectWithValue("No organization selected");
  try {
    const page = await timeApi.listTaskWorklogs(taskId, orgId, pageToken);
    return { taskId, ...page, replace: !pageToken };
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
    if (!input.userId) refreshOwnSheet(dispatch, getState(), input.workDate);
    return result;
  } catch (error) {
    return rejectWithValue(messageOf(error, "Failed to log time"));
  }
});

/** One entry per day of a period; stops at the first refusal so the rest can be fixed. */
export const createWorklogRange = createAsyncThunk<
  { created: number; failed: string | null },
  {
    days: string[];
    /** "HH:mm" in `timeZone`; each day's entry starts at this time on its own day. */
    startTime?: string;
    timeZone: string;
  } & Omit<CreateWorklogInput, "workDate" | "startedAt">,
  ThunkConfig
>("time/createWorklogRange", async ({ days, startTime, timeZone, ...input }, { dispatch }) => {
  let created = 0;
  for (const day of days) {
    const startedAt = startTime ? instantOf(day, startTime, timeZone) : undefined;
    const result = await dispatch(
      createWorklog({ ...input, workDate: day, ...(startedAt ? { startedAt } : {}) }),
    );
    if (!createWorklog.fulfilled.match(result)) return { created, failed: day };
    created += 1;
  }
  return { created, failed: null };
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
    if (result.worklog.userId === getState().auth.user?.id) {
      refreshOwnSheet(dispatch, getState(), result.worklog.workDate);
    }
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
  const state = getState();
  const orgId = organizationIdOf(state);
  if (!orgId) return rejectWithValue("No organization selected");
  const own = Object.values(state.time.weeks)
    .flat()
    .find((entry) => entry.id === worklogId);
  try {
    const result = await timeApi.deleteWorklog(worklogId, orgId);
    applyRollup(dispatch, taskId, result.taskTimeSpentMinutes);
    if (own) refreshOwnSheet(dispatch, getState(), own.workDate);
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

export const saveTimePolicy = createAsyncThunk<TimePolicy, TimePolicy, ThunkConfig>(
  "time/saveTimePolicy",
  async (policy, { getState, rejectWithValue }) => {
    const orgId = organizationIdOf(getState());
    if (!orgId) return rejectWithValue("No organization selected");
    try {
      return await timeApi.updateTimePolicy(policy, orgId);
    } catch (error) {
      return rejectWithValue(messageOf(error, "Failed to save the time policy"));
    }
  },
);

export const fetchReviewEligibility = createAsyncThunk<boolean, string, ThunkConfig>(
  "time/fetchReviewEligibility",
  async (day, { getState, rejectWithValue }) => {
    const orgId = organizationIdOf(getState());
    if (!orgId) return rejectWithValue("No organization selected");
    try {
      const page = await timeApi.listReviewTimesheets({ periodStart: day }, orgId);
      return page.viewerIsTimekeepingAdmin || page.rows.length > 0;
    } catch (error) {
      return rejectWithValue(messageOf(error, "Failed to load review access"));
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
  { key: string } & UserWeek,
  { from: string; to: string },
  ThunkConfig
>("time/fetchUserWorklogs", async ({ from, to }, { getState, rejectWithValue }) => {
  const orgId = organizationIdOf(getState());
  if (!orgId) return rejectWithValue("No organization selected");
  try {
    const week = await timeApi.listUserWorklogs(orgId, from, to);
    return { key: weekRangeKey(from, to), ...week };
  } catch (error) {
    return rejectWithValue(messageOf(error, "Failed to load your time"));
  }
});

export const fetchWeekEvents = createAsyncThunk<
  { key: string; events: WeekEvent[] },
  { from: string; to: string },
  ThunkConfig
>("time/fetchWeekEvents", async ({ from, to }, { getState, rejectWithValue }) => {
  const orgId = organizationIdOf(getState());
  if (!orgId) return rejectWithValue("No organization selected");
  try {
    const events = await timeApi.listWeekEvents(orgId, from, to);
    return { key: weekRangeKey(from, to), events };
  } catch (error) {
    return rejectWithValue(messageOf(error, "Failed to load your calendar"));
  }
});

/** Refresh the signed-in person's sheet after their own entry changed under a pending period. */
function refreshOwnSheet(dispatch: AppDispatch, state: RootState, day: string): void {
  if (state.time.policy?.approvalsEnabled) void dispatch(fetchTimesheet({ day }));
}

export const fetchTimesheet = createAsyncThunk<Timesheet, { day: string }, ThunkConfig>(
  "time/fetchTimesheet",
  async ({ day }, { getState, rejectWithValue }) => {
    const orgId = organizationIdOf(getState());
    if (!orgId) return rejectWithValue("No organization selected");
    try {
      return await timeApi.getTimesheet(day, orgId);
    } catch (error) {
      return rejectWithValue(messageOf(error, "Failed to load the timesheet"));
    }
  },
);

export const submitTimesheet = createAsyncThunk<
  Timesheet,
  { day: string; comment: string; reviewerUserId?: string },
  ThunkConfig
>(
  "time/submitTimesheet",
  async ({ day, comment, reviewerUserId }, { getState, dispatch, rejectWithValue }) => {
    const orgId = organizationIdOf(getState());
    if (!orgId) return rejectWithValue("No organization selected");
    try {
      const sheet = await timeApi.submitTimesheet(day, comment, orgId, undefined, reviewerUserId);
      // Submitting stops a timer still running inside the period.
      void dispatch(fetchActiveTimer());
      void dispatch(fetchUserWorklogs({ from: sheet.periodStart, to: sheet.periodEnd }));
      return sheet;
    } catch (error) {
      return rejectWithValue(messageOf(error, "Failed to submit the timesheet"));
    }
  },
);

export const recallTimesheet = createAsyncThunk<Timesheet, { day: string }, ThunkConfig>(
  "time/recallTimesheet",
  async ({ day }, { getState, rejectWithValue }) => {
    const orgId = organizationIdOf(getState());
    if (!orgId) return rejectWithValue("No organization selected");
    try {
      return await timeApi.recallTimesheet(day, orgId);
    } catch (error) {
      return rejectWithValue(messageOf(error, "Failed to recall the timesheet"));
    }
  },
);

export const fetchReviewTimesheets = createAsyncThunk<ReviewPage, ReviewQuery, ThunkConfig>(
  "time/fetchReviewTimesheets",
  async (query, { getState, rejectWithValue }) => {
    const orgId = organizationIdOf(getState());
    if (!orgId) return rejectWithValue("No organization selected");
    try {
      return await timeApi.listReviewTimesheets(query, orgId);
    } catch (error) {
      return rejectWithValue(messageOf(error, "Failed to load the timesheets to review"));
    }
  },
);

export const fetchProjectReport = createAsyncThunk<ProjectReport, ReportQuery, ThunkConfig>(
  "time/fetchProjectReport",
  async (query, { getState, rejectWithValue }) => {
    const orgId = organizationIdOf(getState());
    if (!orgId) return rejectWithValue("No organization selected");
    try {
      return await timeApi.aggregateWorklogs(query, orgId);
    } catch (error) {
      return rejectWithValue(messageOf(error, "Failed to load the time report"));
    }
  },
);

export const approveTimesheet = createAsyncThunk<
  Timesheet,
  { timesheetId: string; comment?: string },
  ThunkConfig
>("time/approveTimesheet", async ({ timesheetId, comment }, { getState, rejectWithValue }) => {
  const orgId = organizationIdOf(getState());
  if (!orgId) return rejectWithValue("No organization selected");
  try {
    return await timeApi.approveTimesheet(timesheetId, comment ?? "", orgId);
  } catch (error) {
    return rejectWithValue(messageOf(error, "Failed to approve the timesheet"));
  }
});

export const rejectTimesheet = createAsyncThunk<
  Timesheet,
  { timesheetId: string; comment: string },
  ThunkConfig
>("time/rejectTimesheet", async ({ timesheetId, comment }, { getState, rejectWithValue }) => {
  const orgId = organizationIdOf(getState());
  if (!orgId) return rejectWithValue("No organization selected");
  try {
    return await timeApi.rejectTimesheet(timesheetId, comment, orgId);
  } catch (error) {
    return rejectWithValue(messageOf(error, "Failed to reject the timesheet"));
  }
});

export const grantGrace = createAsyncThunk<
  Timesheet,
  { userId: string; day: string; hours: number },
  ThunkConfig
>("time/grantGrace", async ({ userId, day, hours }, { getState, rejectWithValue }) => {
  const orgId = organizationIdOf(getState());
  if (!orgId) return rejectWithValue("No organization selected");
  try {
    return await timeApi.grantGrace(userId, day, hours, orgId);
  } catch (error) {
    return rejectWithValue(messageOf(error, "Failed to grant grace"));
  }
});

export const closePeriod = createAsyncThunk<TimePeriod, { day: string }, ThunkConfig>(
  "time/closePeriod",
  async ({ day }, { getState, rejectWithValue }) => {
    const orgId = organizationIdOf(getState());
    if (!orgId) return rejectWithValue("No organization selected");
    try {
      return await timeApi.closePeriod(day, orgId);
    } catch (error) {
      return rejectWithValue(messageOf(error, "Failed to close the period"));
    }
  },
);

export const reopenPeriod = createAsyncThunk<TimePeriod, { day: string }, ThunkConfig>(
  "time/reopenPeriod",
  async ({ day }, { getState, rejectWithValue }) => {
    const orgId = organizationIdOf(getState());
    if (!orgId) return rejectWithValue("No organization selected");
    try {
      return await timeApi.reopenPeriod(day, orgId);
    } catch (error) {
      return rejectWithValue(messageOf(error, "Failed to reopen the period"));
    }
  },
);

/** Another person's entries over a range, for a reviewer's read-only week. */
export const fetchPersonWorklogs = createAsyncThunk<
  { key: string } & UserWeek,
  { userId: string; from: string; to: string },
  ThunkConfig
>("time/fetchPersonWorklogs", async ({ userId, from, to }, { getState, rejectWithValue }) => {
  const orgId = organizationIdOf(getState());
  if (!orgId) return rejectWithValue("No organization selected");
  try {
    const week = await timeApi.listUserWorklogs(orgId, from, to, userId);
    return { key: personRangeKey(userId, from, to), ...week };
  } catch (error) {
    return rejectWithValue(messageOf(error, "Failed to load their time"));
  }
});

export const fetchPersonTimesheet = createAsyncThunk<
  Timesheet,
  { userId: string; day: string },
  ThunkConfig
>("time/fetchPersonTimesheet", async ({ userId, day }, { getState, rejectWithValue }) => {
  const orgId = organizationIdOf(getState());
  if (!orgId) return rejectWithValue("No organization selected");
  try {
    return await timeApi.getTimesheet(day, orgId, userId);
  } catch (error) {
    return rejectWithValue(messageOf(error, "Failed to load their timesheet"));
  }
});

export function personRangeKey(userId: string, from: string, to: string): string {
  return `${userId}:${weekRangeKey(from, to)}`;
}

export const fetchSprintCapacity = createAsyncThunk<
  { sprintId: string; capacity: SprintCapacity },
  { sprintId: string },
  ThunkConfig
>("time/fetchSprintCapacity", async ({ sprintId }, { getState, rejectWithValue }) => {
  const orgId = organizationIdOf(getState());
  if (!orgId) return rejectWithValue("No organization selected");
  try {
    const capacity = await timeApi.getSprintCapacity(sprintId, orgId);
    return { sprintId, capacity };
  } catch (error) {
    return rejectWithValue(messageOf(error, "Failed to load the sprint capacity"));
  }
});

/** Timekeeping admins only; the policy comes back naming the project either way. */
export const createInternalTimeProject = createAsyncThunk<InternalProjectResult, void, ThunkConfig>(
  "time/createInternalTimeProject",
  async (_, { getState, rejectWithValue }) => {
    const orgId = organizationIdOf(getState());
    if (!orgId) return rejectWithValue("No organization selected");
    try {
      return await timeApi.createInternalTimeProject(orgId);
    } catch (error) {
      return rejectWithValue(messageOf(error, "Failed to create the internal time project"));
    }
  },
);
