import { describe, expect, it } from "vitest";
import type { Task } from "@/features/projects/types/project";
import type { FilterCondition, FilterConfig } from "@/features/projects/types/views";
import {
  HIERARCHY_DEPTH_FIELD_ID,
  HIERARCHY_HAS_SUBTASKS_FIELD_ID,
  HIERARCHY_IN_EPIC_FIELD_ID,
  HIERARCHY_ROOT_ONLY_FIELD_ID,
  applyFilters,
  buildTaskHierarchyIndex,
} from "@/features/projects/utils/filterTasks";

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    projectId: "proj-1",
    organizationId: "org-1",
    ownerId: "user-1",
    title: `Task ${overrides.id}`,
    description: "",
    status: "status_todo",
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
    urn: `urn:uniffy:content:TASK:${overrides.id}`,
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

/**
 *  epic
 *  |- story
 *     |- task-a
 *     |- task-b
 *  loose (root, no children)
 */
function buildSampleTasks(): Task[] {
  return [
    makeTask({ id: "epic", taskType: "epic" }),
    makeTask({ id: "story", taskType: "story", parentId: "epic" }),
    makeTask({ id: "task-a", parentId: "story" }),
    makeTask({ id: "task-b", parentId: "story" }),
    makeTask({ id: "loose" }),
  ];
}

function applyOne(tasks: Task[], condition: FilterCondition): Task[] {
  const config: FilterConfig = { conditions: [condition], logic: "and" };
  return applyFilters(tasks, config, buildTaskHierarchyIndex(tasks));
}

describe("buildTaskHierarchyIndex", () => {
  it("computes depth in the tree (0 for root)", () => {
    const tasks = buildSampleTasks();
    const index = buildTaskHierarchyIndex(tasks);
    expect(index.depthById.get("epic")).toBe(0);
    expect(index.depthById.get("story")).toBe(1);
    expect(index.depthById.get("task-a")).toBe(2);
    expect(index.depthById.get("loose")).toBe(0);
  });

  it("collects all ancestor ids per task", () => {
    const tasks = buildSampleTasks();
    const index = buildTaskHierarchyIndex(tasks);
    expect([...(index.ancestorIdsById.get("task-a") ?? [])]).toEqual(
      expect.arrayContaining(["story", "epic"]),
    );
    expect(index.ancestorIdsById.get("epic")?.size).toBe(0);
  });

  it("marks parent ids that have at least one child", () => {
    const tasks = buildSampleTasks();
    const index = buildTaskHierarchyIndex(tasks);
    expect(index.hasChildren.has("epic")).toBe(true);
    expect(index.hasChildren.has("story")).toBe(true);
    expect(index.hasChildren.has("task-a")).toBe(false);
    expect(index.hasChildren.has("loose")).toBe(false);
  });

  it("tolerates a cyclic parent_id chain without spinning", () => {
    const tasks = [makeTask({ id: "a", parentId: "b" }), makeTask({ id: "b", parentId: "a" })];
    const index = buildTaskHierarchyIndex(tasks);
    expect(index.depthById.get("a")).toBeLessThan(64);
    expect(index.depthById.get("b")).toBeLessThan(64);
  });
});

describe("applyFilters - root_only pseudo-field", () => {
  it("is_empty returns only top-level tasks", () => {
    const tasks = buildSampleTasks();
    const result = applyOne(tasks, {
      id: "c1",
      fieldId: HIERARCHY_ROOT_ONLY_FIELD_ID,
      operator: "is_empty",
      value: null,
    });
    expect(result.map((t) => t.id).sort()).toEqual(["epic", "loose"]);
  });

  it("is_not_empty returns only tasks with a parent", () => {
    const tasks = buildSampleTasks();
    const result = applyOne(tasks, {
      id: "c1",
      fieldId: HIERARCHY_ROOT_ONLY_FIELD_ID,
      operator: "is_not_empty",
      value: null,
    });
    expect(result.map((t) => t.id).sort()).toEqual(["story", "task-a", "task-b"]);
  });
});

describe("applyFilters - has_subtasks pseudo-field", () => {
  it("is_not_empty returns only parent tasks", () => {
    const tasks = buildSampleTasks();
    const result = applyOne(tasks, {
      id: "c1",
      fieldId: HIERARCHY_HAS_SUBTASKS_FIELD_ID,
      operator: "is_not_empty",
      value: null,
    });
    expect(result.map((t) => t.id).sort()).toEqual(["epic", "story"]);
  });

  it("is_empty returns only leaf tasks", () => {
    const tasks = buildSampleTasks();
    const result = applyOne(tasks, {
      id: "c1",
      fieldId: HIERARCHY_HAS_SUBTASKS_FIELD_ID,
      operator: "is_empty",
      value: null,
    });
    expect(result.map((t) => t.id).sort()).toEqual(["loose", "task-a", "task-b"]);
  });
});

describe("applyFilters - in_epic pseudo-field", () => {
  it("equals returns the epic itself and its full subtree", () => {
    const tasks = buildSampleTasks();
    const result = applyOne(tasks, {
      id: "c1",
      fieldId: HIERARCHY_IN_EPIC_FIELD_ID,
      operator: "equals",
      value: "epic",
    });
    expect(result.map((t) => t.id).sort()).toEqual(["epic", "story", "task-a", "task-b"]);
  });

  it("not_equals returns everything outside the epic subtree", () => {
    const tasks = buildSampleTasks();
    const result = applyOne(tasks, {
      id: "c1",
      fieldId: HIERARCHY_IN_EPIC_FIELD_ID,
      operator: "not_equals",
      value: "epic",
    });
    expect(result.map((t) => t.id)).toEqual(["loose"]);
  });
});

describe("applyFilters - depth pseudo-field", () => {
  it("equals=2 matches only the deepest tasks", () => {
    const tasks = buildSampleTasks();
    const result = applyOne(tasks, {
      id: "c1",
      fieldId: HIERARCHY_DEPTH_FIELD_ID,
      operator: "equals",
      value: 2,
    });
    expect(result.map((t) => t.id).sort()).toEqual(["task-a", "task-b"]);
  });

  it("between=[1,2] excludes root tasks and goes through depth 2", () => {
    const tasks = buildSampleTasks();
    const result = applyOne(tasks, {
      id: "c1",
      fieldId: HIERARCHY_DEPTH_FIELD_ID,
      operator: "between",
      value: [1, 2] as unknown as string[],
    });
    expect(result.map((t) => t.id).sort()).toEqual(["story", "task-a", "task-b"]);
  });

  it("greater_than=0 excludes only root tasks", () => {
    const tasks = buildSampleTasks();
    const result = applyOne(tasks, {
      id: "c1",
      fieldId: HIERARCHY_DEPTH_FIELD_ID,
      operator: "greater_than",
      value: 0,
    });
    expect(result.map((t) => t.id).sort()).toEqual(["story", "task-a", "task-b"]);
  });
});

describe("applyFilters - composing hierarchy filters", () => {
  it("in_epic AND depth=1 returns direct children of the epic", () => {
    const tasks = buildSampleTasks();
    const config: FilterConfig = {
      conditions: [
        {
          id: "c1",
          fieldId: HIERARCHY_IN_EPIC_FIELD_ID,
          operator: "equals",
          value: "epic",
        },
        { id: "c2", fieldId: HIERARCHY_DEPTH_FIELD_ID, operator: "equals", value: 1 },
      ],
      logic: "and",
    };
    const result = applyFilters(tasks, config, buildTaskHierarchyIndex(tasks));
    expect(result.map((t) => t.id)).toEqual(["story"]);
  });

  it("root_only AND has_subtasks returns parent root tasks", () => {
    const tasks = buildSampleTasks();
    const config: FilterConfig = {
      conditions: [
        {
          id: "c1",
          fieldId: HIERARCHY_ROOT_ONLY_FIELD_ID,
          operator: "is_empty",
          value: null,
        },
        {
          id: "c2",
          fieldId: HIERARCHY_HAS_SUBTASKS_FIELD_ID,
          operator: "is_not_empty",
          value: null,
        },
      ],
      logic: "and",
    };
    const result = applyFilters(tasks, config, buildTaskHierarchyIndex(tasks));
    expect(result.map((t) => t.id)).toEqual(["epic"]);
  });
});
