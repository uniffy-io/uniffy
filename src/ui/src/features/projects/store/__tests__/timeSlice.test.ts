import { describe, expect, it } from "vitest";
import type { RootState } from "@/app/store";
import type { Timer, Worklog } from "@/features/projects/types/time";
import {
  initialTimeState,
  selectSheetsTouching,
  selectSprintCapacity,
  selectWeekDays,
  selectWeekEvents,
  timeReducer,
} from "@/features/projects/store/timeSlice";
import {
  approveTimesheet,
  closePeriod,
  createInternalTimeProject,
  createWorklog,
  deleteWorklog,
  fetchActiveTimer,
  fetchReviewTimesheets,
  fetchSprintCapacity,
  fetchTaskWorklogs,
  fetchTimesheet,
  fetchUserWorklogs,
  fetchWeekEvents,
  pauseTimer,
  startTimer,
  stopTimer,
  updateWorklog,
} from "@/features/projects/store/timeThunks";

function entry(id: string, overrides: Partial<Worklog> = {}): Worklog {
  return {
    id,
    taskId: "task-1",
    projectId: "project-1",
    userId: "user-1",
    createdByUserId: "user-1",
    workDate: "2026-10-22",
    startedAt: null,
    durationMinutes: 30,
    description: "",
    source: "manual",
    createdAt: "2026-10-22T10:00:00.000Z",
    updatedAt: "2026-10-22T10:00:00.000Z",
    ...overrides,
  };
}

describe("timeSlice", () => {
  it("stores a task's entries newest day first", () => {
    const state = timeReducer(
      initialTimeState,
      fetchTaskWorklogs.fulfilled(
        {
          taskId: "task-1",
          worklogs: [
            entry("a", { workDate: "2026-10-20" }),
            entry("b", { workDate: "2026-10-22" }),
          ],
        },
        "req",
        "task-1",
      ),
    );
    expect(state.worklogsByTask["task-1"].map((w) => w.id)).toEqual(["b", "a"]);
    expect(state.loadingByTask["task-1"]).toBe(false);
  });

  it("prepends a created entry, replaces an updated one and drops a deleted one", () => {
    let state = timeReducer(
      initialTimeState,
      fetchTaskWorklogs.fulfilled({ taskId: "task-1", worklogs: [entry("a")] }, "req", "task-1"),
    );
    state = timeReducer(
      state,
      createWorklog.fulfilled(
        { worklog: entry("b", { workDate: "2026-10-23" }), taskTimeSpentMinutes: 60 },
        "req",
        { taskId: "task-1", workDate: "2026-10-23", durationMinutes: 30 },
      ),
    );
    expect(state.worklogsByTask["task-1"].map((w) => w.id)).toEqual(["b", "a"]);

    state = timeReducer(
      state,
      updateWorklog.fulfilled(
        { worklog: entry("a", { durationMinutes: 90 }), taskTimeSpentMinutes: 120 },
        "req",
        { id: "a", taskId: "task-1", durationMinutes: 90 },
      ),
    );
    expect(state.worklogsByTask["task-1"].find((w) => w.id === "a")?.durationMinutes).toBe(90);

    state = timeReducer(
      state,
      deleteWorklog.fulfilled(
        { taskId: "task-1", worklogId: "b", taskTimeSpentMinutes: 90 },
        "req",
        {
          worklogId: "b",
          taskId: "task-1",
        },
      ),
    );
    expect(state.worklogsByTask["task-1"].map((w) => w.id)).toEqual(["a"]);
    expect(state.saving).toBe(false);
  });

  it("tracks the saving flag around a write", () => {
    const pending = timeReducer(
      initialTimeState,
      createWorklog.pending("req", {
        taskId: "task-1",
        workDate: "2026-10-22",
        durationMinutes: 5,
      }),
    );
    expect(pending.saving).toBe(true);
    const rejected = timeReducer(
      pending,
      createWorklog.rejected(
        null,
        "req",
        { taskId: "task-1", workDate: "2026-10-22", durationMinutes: 5 },
        "nope",
      ),
    );
    expect(rejected.saving).toBe(false);
  });
});

function timer(overrides: Partial<Timer> = {}): Timer {
  return {
    id: "timer-1",
    taskId: "task-1",
    projectId: "project-1",
    description: "",
    startedAt: "2026-10-22T10:00:00.000Z",
    accumulatedSeconds: 0,
    pausedAt: null,
    pauseReason: null,
    taskTitle: "Home feed",
    taskNumber: 169,
    projectSlug: "mob",
    ...overrides,
  };
}

describe("timeSlice timers", () => {
  it("records the fetched timer and that the first fetch happened", () => {
    const state = timeReducer(initialTimeState, fetchActiveTimer.fulfilled(null, "req"));
    expect(state.activeTimer).toBeNull();
    expect(state.timerLoaded).toBe(true);
  });

  it("starting replaces the timer and files the stopped entry under its task when loaded", () => {
    let state = timeReducer(
      initialTimeState,
      fetchTaskWorklogs.fulfilled({ taskId: "task-0", worklogs: [] }, "req", "task-0"),
    );
    state = timeReducer(state, startTimer.pending("req", { taskId: "task-1" }));
    expect(state.timerBusy).toBe(true);
    state = timeReducer(
      state,
      startTimer.fulfilled(
        {
          timer: timer(),
          stoppedWorklog: entry("stopped", { taskId: "task-0", source: "timer" }),
        },
        "req",
        { taskId: "task-1" },
      ),
    );
    expect(state.timerBusy).toBe(false);
    expect(state.activeTimer?.taskId).toBe("task-1");
    expect(state.worklogsByTask["task-0"].map((w) => w.id)).toEqual(["stopped"]);
    expect(state.worklogsByTask["task-1"]).toBeUndefined();
  });

  it("pause swaps in the paused timer and stop clears it and files the entry", () => {
    let state = timeReducer(initialTimeState, fetchActiveTimer.fulfilled(timer(), "req"));
    state = timeReducer(
      state,
      pauseTimer.fulfilled(timer({ startedAt: null, accumulatedSeconds: 90 }), "req"),
    );
    expect(state.activeTimer?.startedAt).toBeNull();
    expect(state.activeTimer?.accumulatedSeconds).toBe(90);

    state = timeReducer(
      state,
      fetchTaskWorklogs.fulfilled({ taskId: "task-1", worklogs: [entry("a")] }, "req", "task-1"),
    );
    state = timeReducer(
      state,
      stopTimer.fulfilled(
        {
          taskId: "task-1",
          worklog: entry("from-timer", { source: "timer", workDate: "2026-10-23" }),
          taskTimeSpentMinutes: 120,
        },
        "req",
        { workDate: "2026-10-23", durationMinutes: 90 },
      ),
    );
    expect(state.activeTimer).toBeNull();
    expect(state.worklogsByTask["task-1"].map((w) => w.id)).toEqual(["from-timer", "a"]);
  });

  it("a discarded stop clears the timer without touching the entries", () => {
    let state = timeReducer(initialTimeState, fetchActiveTimer.fulfilled(timer(), "req"));
    state = timeReducer(
      state,
      stopTimer.fulfilled({ taskId: "task-1", worklog: null, taskTimeSpentMinutes: 0 }, "req", {
        discard: true,
      }),
    );
    expect(state.activeTimer).toBeNull();
    expect(state.worklogsByTask).toEqual({});
  });
});

describe("timeSlice weeks", () => {
  const range = { from: "2026-10-19", to: "2026-10-25" };
  const key = "2026-10-19:2026-10-25";

  it("keeps a fetched range and files later writes into it by day", () => {
    let state = timeReducer(initialTimeState, fetchUserWorklogs.pending("req", range));
    expect(state.weekLoading[key]).toBe(true);
    state = timeReducer(
      state,
      fetchUserWorklogs.fulfilled(
        { key, worklogs: [entry("a", { workDate: "2026-10-20" })], days: [] },
        "req",
        range,
      ),
    );
    expect(state.weekLoading[key]).toBe(false);

    state = timeReducer(
      state,
      createWorklog.fulfilled(
        { worklog: entry("b", { workDate: "2026-10-22" }), taskTimeSpentMinutes: 60 },
        "req",
        { taskId: "task-1", workDate: "2026-10-22", durationMinutes: 30 },
      ),
    );
    expect(state.weeks[key].map((w) => w.id)).toEqual(["b", "a"]);

    // Logged for someone else: their entry, not this person's week.
    state = timeReducer(
      state,
      createWorklog.fulfilled(
        {
          worklog: entry("theirs", { workDate: "2026-10-22", userId: "other" }),
          taskTimeSpentMinutes: 90,
        },
        "req",
        { taskId: "task-1", workDate: "2026-10-22", durationMinutes: 30, userId: "other" },
      ),
    );
    expect(state.weeks[key].map((w) => w.id)).toEqual(["b", "a"]);

    // Moved out of the range: it leaves the week.
    state = timeReducer(
      state,
      updateWorklog.fulfilled(
        { worklog: entry("b", { workDate: "2026-11-02" }), taskTimeSpentMinutes: 60 },
        "req",
        { id: "b", taskId: "task-1", workDate: "2026-11-02" },
      ),
    );
    expect(state.weeks[key].map((w) => w.id)).toEqual(["a"]);

    state = timeReducer(
      state,
      deleteWorklog.fulfilled(
        { taskId: "task-1", worklogId: "a", taskTimeSpentMinutes: 0 },
        "req",
        {
          worklogId: "a",
          taskId: "task-1",
        },
      ),
    );
    expect(state.weeks[key]).toEqual([]);
  });
});

describe("timeSlice approvals", () => {
  const sheet = {
    id: "s1",
    userId: "u1",
    periodStart: "2026-10-12",
    periodEnd: "2026-10-18",
    status: "submitted" as const,
    submittedAt: "2026-10-19T08:00:00Z",
    submittedByUserId: "u1",
    submitComment: "",
    reviewerUserId: null,
    reviewedAt: null,
    reviewComment: "",
    graceUntil: null,
    locked: true,
    periodClosed: false,
    canReview: true,
    totalMinutes: 600,
    requiredMinutes: 2400,
  };
  const row = {
    userId: "u1",
    status: "submitted" as const,
    periodMinutes: 600,
    requiredMinutes: 2400,
    days: [],
    timesheet: sheet,
  };
  const period = {
    id: "",
    startDate: "2026-10-12",
    endDate: "2026-10-18",
    status: "open" as const,
    closedByUserId: null,
    closedAt: null,
  };

  it("files the person's own sheet by period start and finds it by touching range", () => {
    const state = timeReducer(initialTimeState, {
      type: fetchTimesheet.fulfilled.type,
      payload: sheet,
    });
    expect(state.sheets["2026-10-12"]).toEqual(sheet);
    const root = { time: state } as unknown as RootState;
    expect(selectSheetsTouching("2026-10-14", "2026-10-20")(root)).toEqual([sheet]);
    expect(selectSheetsTouching("2026-10-19", "2026-10-25")(root)).toEqual([]);
  });

  it("appends inbox pages and patches a reviewed row everywhere", () => {
    let state = timeReducer(initialTimeState, {
      type: fetchReviewTimesheets.fulfilled.type,
      payload: { rows: [row], nextPageToken: "50", period, viewerIsTimekeepingAdmin: true },
      meta: { arg: { periodStart: "2026-10-12" } },
    });
    state = timeReducer(state, {
      type: fetchReviewTimesheets.fulfilled.type,
      payload: {
        rows: [{ ...row, userId: "u2", timesheet: { ...sheet, userId: "u2" } }],
        nextPageToken: "",
        period,
        viewerIsTimekeepingAdmin: true,
      },
      meta: { arg: { periodStart: "2026-10-12", pageToken: "50" } },
    });
    expect(state.review.rows.map((r) => r.userId)).toEqual(["u1", "u2"]);
    expect(state.review.loaded).toBe(true);
    state = timeReducer(state, {
      type: approveTimesheet.fulfilled.type,
      payload: { ...sheet, status: "approved" as const },
    });
    expect(state.review.rows[0].status).toBe("approved");
    expect(state.review.rows[0].timesheet.status).toBe("approved");
    expect(state.personSheets["u1:2026-10-12"].status).toBe("approved");
  });

  it("marks every sheet of a closed period as closed and locked", () => {
    let state = timeReducer(initialTimeState, {
      type: fetchTimesheet.fulfilled.type,
      payload: { ...sheet, status: "open" as const, locked: false },
    });
    state = timeReducer(state, {
      type: closePeriod.fulfilled.type,
      payload: { ...period, status: "closed" as const },
    });
    expect(state.sheets["2026-10-12"].periodClosed).toBe(true);
    expect(state.sheets["2026-10-12"].locked).toBe(true);
  });

  it("keeps the served day requirements beside the week's entries", () => {
    const range = { from: "2026-10-19", to: "2026-10-25" };
    const key = "2026-10-19:2026-10-25";
    const days = [
      { day: "2026-10-19", minutes: 0, requiredMinutes: 480, off: false },
      { day: "2026-10-20", minutes: 60, requiredMinutes: 240, off: true },
    ];
    const state = timeReducer(
      initialTimeState,
      fetchUserWorklogs.fulfilled({ key, worklogs: [], days }, "req", range),
    );
    expect(selectWeekDays(key)({ time: state } as unknown as RootState)).toEqual(days);
    expect(selectWeekDays("other")({ time: state } as unknown as RootState)).toEqual([]);
  });

  it("stores a sprint's capacity and the internal project's policy", () => {
    const capacity = {
      rows: [{ userId: "u1", capacityMinutes: 4800, estimatedMinutes: 600, loggedMinutes: 90 }],
      capacityMinutes: 4800,
      estimatedMinutes: 600,
      loggedMinutes: 90,
    };
    let state = timeReducer(
      initialTimeState,
      fetchSprintCapacity.fulfilled({ sprintId: "s1", capacity }, "req", { sprintId: "s1" }),
    );
    expect(selectSprintCapacity("s1")({ time: state } as unknown as RootState)).toEqual(capacity);
    expect(selectSprintCapacity("s2")({ time: state } as unknown as RootState)).toBeNull();

    const policy = {
      organizationId: "org",
      enabled: true,
      periodType: "weekly" as const,
      weekStart: "monday",
      monthStartDay: 1,
      approvalsEnabled: false,
      lockOnSubmit: true,
      periodLockDelayDays: 2,
      allowLogForOthers: true,
      requiredMinutesPerDay: 480,
      timerRoundingMinutes: 1,
      allowFutureDates: false,
      maxDaysBack: null,
      maxTimerHours: 12,
      autoSubmit: false,
      holidays: [],
      internalProjectId: "p-int",
      remindersEnabled: false,
      reminderHourUtc: 9,
    };
    state = timeReducer(
      state,
      createInternalTimeProject.fulfilled(
        { projectId: "p-int", slug: "INT", created: true, policy },
        "req",
      ),
    );
    expect(state.policy?.internalProjectId).toBe("p-int");
  });

  it("keeps the calendar of a loaded range for the suggestions rail", () => {
    const event = {
      id: "e1",
      title: "Standup",
      startTime: "2026-10-20T09:00:00.000Z",
      endTime: "2026-10-20T09:15:00.000Z",
      allDay: false,
      outOfOffice: false,
      focusTime: false,
      cancelled: false,
      transparent: false,
      participantIds: ["user-1"],
    };
    const state = timeReducer(
      initialTimeState,
      fetchWeekEvents.fulfilled({ key: "2026-10-19:2026-10-25", events: [event] }, "req", {
        from: "2026-10-19",
        to: "2026-10-25",
      }),
    );
    const root = { time: state } as RootState;
    expect(selectWeekEvents("2026-10-19:2026-10-25")(root)).toEqual([event]);
    expect(selectWeekEvents("2026-10-26:2026-11-01")(root)).toEqual([]);
  });
});
