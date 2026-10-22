import { describe, expect, it } from "vitest";
import type { Worklog } from "@/features/projects/types/time";
import { initialTimeState, timeReducer } from "@/features/projects/store/timeSlice";
import {
  createWorklog,
  deleteWorklog,
  fetchTaskWorklogs,
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
