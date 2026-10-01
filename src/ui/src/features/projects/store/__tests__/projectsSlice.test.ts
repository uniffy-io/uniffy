import { describe, expect, it } from "vitest";
import type { Project, Task } from "@/features/projects/types/project";
import { SYSTEM_FIELD_IDS, type SelectOption } from "@/features/projects/types/fields";
import {
  optimisticUpdateTask,
  projectsSlice,
  type ProjectsState,
} from "@/features/projects/store/projectsSlice";
import {
  deleteTask,
  deleteTasks,
  fetchProjects,
  fetchProjectTasks,
  updateTask,
} from "@/features/projects/store/projectsThunks";

const reducer = projectsSlice.reducer;

const STATUSES: SelectOption[] = [
  { id: "status_backlog", label: "Backlog", color: "", sortOrder: 0, semantic: "todo" },
  { id: "status_doing", label: "Doing", color: "", sortOrder: 1, semantic: "in_progress" },
  { id: "status_done", label: "QA", color: "", sortOrder: 2, semantic: "review" },
  { id: "status_shipped", label: "Shipped", color: "", sortOrder: 3, semantic: "completed" },
];

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    projectId: "proj-1",
    organizationId: "org-1",
    ownerId: "user-1",
    title: id,
    description: "",
    status: "status_backlog",
    priority: "priority_medium",
    assigneeIds: [],
    startDate: null,
    dueDate: null,
    completedAt: null,
    parentId: null,
    blockedByTaskIds: [],
    isMilestone: false,
    recurrenceRule: null,
    sortOrder: 0,
    fieldValues: {},
    outgoingReferences: [],
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    urn: `urn:uniffy:content:TASK:${id}`,
    userRole: 0,
    number: 1,
    taskType: "task",
    sprintId: null,
    subtaskTotal: 0,
    subtaskCompleted: 0,
    estimatedMinutes: null,
    timeSpentMinutes: null,
    tagIds: [],
    ...overrides,
  };
}

function stateWith(tasks: Task[]): ProjectsState {
  const initial = reducer(undefined, { type: "@@init" });
  const project = {
    id: "proj-1",
    fieldDefinitions: [
      {
        id: SYSTEM_FIELD_IDS.STATUS,
        projectId: "proj-1",
        name: "Status",
        type: "single_select",
        isRequired: true,
        isSystem: true,
        sortOrder: 0,
        config: { options: STATUSES },
        createdAt: "",
        updatedAt: "",
      },
    ],
  } as unknown as Project;
  return {
    ...initial,
    projects: { [project.id]: project },
    tasks: Object.fromEntries(tasks.map((task) => [task.id, task])),
  };
}

const parent = makeTask("parent", { subtaskTotal: 2, subtaskCompleted: 0 });

describe("optimisticUpdateTask", () => {
  it("counts a subtask moved to a custom completed status and stamps completedAt", () => {
    const state = stateWith([parent, makeTask("sub", { parentId: "parent" })]);
    const next = reducer(state, optimisticUpdateTask({ id: "sub", status: "status_shipped" }));
    expect(next.tasks.parent.subtaskCompleted).toBe(1);
    expect(next.tasks.sub.completedAt).not.toBeNull();
    expect(next._pendingParentSnapshots?.parent.subtaskCompleted).toBe(0);
  });

  it("ignores a status whose id reads like done but whose semantic is review", () => {
    const state = stateWith([parent, makeTask("sub", { parentId: "parent" })]);
    const next = reducer(state, optimisticUpdateTask({ id: "sub", status: "status_done" }));
    expect(next.tasks.parent.subtaskCompleted).toBe(0);
    expect(next.tasks.sub.completedAt).toBeNull();
  });

  it("uncounts a subtask moved out of the completed status and clears completedAt", () => {
    const state = stateWith([
      { ...parent, subtaskCompleted: 1 },
      makeTask("sub", {
        parentId: "parent",
        status: "status_shipped",
        completedAt: "2026-09-01T00:00:00Z",
      }),
    ]);
    const next = reducer(state, optimisticUpdateTask({ id: "sub", status: "status_doing" }));
    expect(next.tasks.parent.subtaskCompleted).toBe(0);
    expect(next.tasks.sub.completedAt).toBeNull();
  });

  it("carries a completed subtask's count to its new parent", () => {
    const other = makeTask("other", { subtaskTotal: 0, subtaskCompleted: 0 });
    const state = stateWith([
      { ...parent, subtaskCompleted: 1 },
      other,
      makeTask("sub", {
        parentId: "parent",
        status: "status_shipped",
        completedAt: "2026-09-01T00:00:00Z",
      }),
    ]);
    const next = reducer(state, optimisticUpdateTask({ id: "sub", parentId: "other" }));
    expect(next.tasks.parent).toMatchObject({ subtaskTotal: 1, subtaskCompleted: 0 });
    expect(next.tasks.other).toMatchObject({ subtaskTotal: 1, subtaskCompleted: 1 });
  });
});

describe("task deletion", () => {
  const completedSub = makeTask("sub", {
    parentId: "parent",
    status: "status_shipped",
    completedAt: "2026-09-01T00:00:00Z",
  });

  it("uncounts a completed subtask", () => {
    const state = stateWith([{ ...parent, subtaskCompleted: 1 }, completedSub]);
    const next = reducer(state, deleteTask.fulfilled(undefined, "req", "sub"));
    expect(next.tasks.parent).toMatchObject({ subtaskTotal: 1, subtaskCompleted: 0 });
    expect(next.tasks.sub).toBeUndefined();
  });

  it("uncounts completed subtasks in a bulk delete", () => {
    const state = stateWith([{ ...parent, subtaskCompleted: 1 }, completedSub]);
    const next = reducer(state, deleteTasks.fulfilled(["sub"], "req", ["sub"]));
    expect(next.tasks.parent).toMatchObject({ subtaskTotal: 1, subtaskCompleted: 0 });
  });
});

it("rolls back every field and parent count when a combined board update fails", () => {
  const task = makeTask("sub", { parentId: parent.id, assigneeIds: ["amy"], sortOrder: 1000 });
  const original = stateWith([parent, task]);
  const request = { id: task.id, status: "status_shipped", sortOrder: 0, assigneeIds: ["zoe"] };
  const optimistic = reducer(original, optimisticUpdateTask(request));
  expect(optimistic.tasks.parent.subtaskCompleted).toBe(1);
  const rejected = reducer(
    optimistic,
    updateTask.rejected(null, "request", request, "Task is blocked"),
  );
  expect(rejected.tasks).toEqual(original.tasks);
  expect(rejected._pendingTaskSnapshot).toBeUndefined();
  expect(rejected._pendingParentSnapshots).toBeUndefined();
});

describe("task list arriving around the project list", () => {
  const project = { id: "proj-1" } as Project;
  const listed = (projects: Project[]) =>
    fetchProjects.fulfilled(projects, "list-request", undefined);
  const tasksLoaded = (tasks: Task[]) =>
    fetchProjectTasks.fulfilled(tasks, "tasks-request", "proj-1");

  it("keeps tasks that land before the project list, then keeps them once it lists the project", () => {
    let state = reducer(undefined, tasksLoaded([makeTask("a"), makeTask("b")]));
    expect(Object.keys(state.tasks)).toEqual(["a", "b"]);
    expect(state.taskListLoadedIds["proj-1"]).toBe(true);

    state = reducer(state, listed([project]));
    expect(Object.keys(state.tasks)).toEqual(["a", "b"]);
  });

  it("prunes early tasks when the project list leaves their project out", () => {
    let state = reducer(undefined, tasksLoaded([makeTask("a")]));
    state = reducer(state, listed([]));
    expect(state.tasks).toEqual({});
  });

  it("drops a late task list for a project the loaded list no longer has", () => {
    let state = reducer(undefined, listed([]));
    state = reducer(state, tasksLoaded([makeTask("a")]));
    expect(state.tasks).toEqual({});
  });
});
