import { configureStore } from "@reduxjs/toolkit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDispatch } from "@/app/store";
import { projectsApi } from "@/features/projects/api/projectsApi";
import { projectsSlice } from "@/features/projects/store/projectsSlice";
import { moveTasksOutOfStatus } from "@/features/projects/store/projectsThunks";
import type { Project, Task } from "@/features/projects/types/project";

vi.mock("@/features/projects/api/projectsApi", () => ({
  projectsApi: { bulkUpdateTasks: vi.fn(), listTasks: vi.fn() },
}));

function migrationFixture() {
  const first = {
    id: "first",
    projectId: "project",
    status: "status_review",
    completedAt: null,
    deletedAt: null,
    subtaskTotal: 2,
    subtaskCompleted: 1,
  } as Task;
  const second = { ...first, id: "second", blockedByTaskIds: ["open"] } as Task;
  const initial = projectsSlice.reducer(undefined, { type: "init" });
  const store = configureStore({
    reducer: {
      projects: projectsSlice.reducer,
      auth: () => ({ currentOrganizationId: "org" }),
    },
    preloadedState: {
      projects: {
        ...initial,
        projects: { project: { id: "project" } as Project },
        tasks: { first, second },
      },
    },
  });
  return { store, dispatch: store.dispatch as AppDispatch, first, second };
}

describe("moveTasksOutOfStatus", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("refreshes committed task moves when a later task fails validation", async () => {
    const { store, dispatch, first, second } = migrationFixture();
    const persisted = { ...first };
    vi.mocked(projectsApi.listTasks).mockImplementation(async () => ({
      tasks: [{ ...persisted }, second],
      protoTasks: [],
    }));
    vi.mocked(projectsApi.bulkUpdateTasks).mockImplementationOnce(async () => {
      persisted.status = "status_done";
      persisted.completedAt = "2026-09-21T12:00:00Z";
      throw new Error("Cannot complete task: blocked by unresolved tasks");
    });

    const result = await dispatch(
      moveTasksOutOfStatus({
        projectId: "project",
        fromStatus: "status_review",
        toStatus: "status_done",
      }),
    );

    expect(result.payload).toBe(false);
    expect(store.getState().projects.tasks.first).toMatchObject({
      status: "status_done",
      completedAt: persisted.completedAt,
    });
    expect(store.getState().projects.tasks.second.status).toBe("status_review");
  });

  it("restores parent counts and loads derived changes after a successful move", async () => {
    const { store, dispatch, first, second } = migrationFixture();
    const movedTasks = [first, second].map((task) => ({
      ...task,
      status: "status_done",
      completedAt: "2026-09-21T12:00:00Z",
    }));
    const recurring = { ...first, id: "recurring", status: "status_todo" };
    vi.mocked(projectsApi.bulkUpdateTasks).mockResolvedValueOnce({
      tasks: movedTasks.map((task) => ({ ...task, subtaskTotal: 0, subtaskCompleted: 0 })),
      protoTasks: [],
      updatedCount: 2,
    });
    vi.mocked(projectsApi.listTasks).mockResolvedValueOnce({
      tasks: [...movedTasks, recurring],
      protoTasks: [],
    });

    const result = await dispatch(
      moveTasksOutOfStatus({
        projectId: "project",
        fromStatus: "status_review",
        toStatus: "status_done",
      }),
    );

    expect(result.payload).toBe(true);
    expect(store.getState().projects.tasks.first).toMatchObject({
      status: "status_done",
      subtaskTotal: 2,
      subtaskCompleted: 1,
    });
    expect(store.getState().projects.tasks.recurring).toEqual(recurring);
  });
});
