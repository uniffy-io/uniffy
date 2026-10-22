import { describe, expect, it } from "vitest";
import type { Timer, Worklog } from "@/features/projects/types/time";
import { initialTimeState, timeReducer } from "@/features/projects/store/timeSlice";
import {
  createWorklog,
  deleteWorklog,
  fetchActiveTimer,
  fetchTaskWorklogs,
  fetchUserWorklogs,
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
        { key, worklogs: [entry("a", { workDate: "2026-10-20" })] },
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
