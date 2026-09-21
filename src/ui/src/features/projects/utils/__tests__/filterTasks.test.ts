import { describe, expect, it } from "vitest";
import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
import type { Task } from "@/features/projects/types/project";
import { makeTask } from "@/features/projects/utils/__tests__/taskFixtures";
import type { FilterCondition, FilterConfig } from "@/features/projects/types/views";
import {
  HIERARCHY_DEPTH_FIELD_ID,
  HIERARCHY_HAS_SUBTASKS_FIELD_ID,
  HIERARCHY_IN_EPIC_FIELD_ID,
  HIERARCHY_ROOT_ONLY_FIELD_ID,
  applyFilters,
  buildTaskHierarchyIndex,
} from "@/features/projects/utils/filterTasks";

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

describe("applyFilters - person fields", () => {
  function buildAssignedTasks(): Task[] {
    return [
      makeTask({ id: "only-a", assigneeIds: ["user-a"] }),
      makeTask({ id: "only-b", assigneeIds: ["user-b"] }),
      makeTask({ id: "b-and-c", assigneeIds: ["user-b", "user-c"] }),
      makeTask({ id: "only-c", assigneeIds: ["user-c"] }),
      makeTask({ id: "nobody", assigneeIds: [] }),
    ];
  }

  function ids(tasks: Task[]): string[] {
    return tasks.map((t) => t.id).sort();
  }

  it("equals with several people matches a task holding any of them", () => {
    const result = applyOne(buildAssignedTasks(), {
      id: "c1",
      fieldId: SYSTEM_FIELD_IDS.ASSIGNEE,
      operator: "equals",
      value: ["user-a", "user-b"],
    });
    expect(ids(result)).toEqual(["b-and-c", "only-a", "only-b"]);
  });

  it("not_equals excludes every task holding any picked person", () => {
    const result = applyOne(buildAssignedTasks(), {
      id: "c1",
      fieldId: SYSTEM_FIELD_IDS.ASSIGNEE,
      operator: "not_equals",
      value: ["user-c"],
    });
    expect(ids(result)).toEqual(["nobody", "only-a", "only-b"]);
  });

  it("a single id stored as a string still matches", () => {
    const result = applyOne(buildAssignedTasks(), {
      id: "c1",
      fieldId: SYSTEM_FIELD_IDS.ASSIGNEE,
      operator: "equals",
      value: "user-c",
    });
    expect(ids(result)).toEqual(["b-and-c", "only-c"]);
  });

  it.each([
    ["an empty list", [] as string[]],
    ["no value", null],
  ])("keeps every task when the picker holds %s", (_label, value) => {
    const tasks = buildAssignedTasks();
    for (const operator of ["equals", "not_equals"] as const) {
      const result = applyOne(tasks, {
        id: "c1",
        fieldId: SYSTEM_FIELD_IDS.ASSIGNEE,
        operator,
        value,
      });
      expect(result).toHaveLength(tasks.length);
    }
  });

  it("is_empty keeps only unassigned tasks", () => {
    const result = applyOne(buildAssignedTasks(), {
      id: "c1",
      fieldId: SYSTEM_FIELD_IDS.ASSIGNEE,
      operator: "is_empty",
      value: null,
    });
    expect(ids(result)).toEqual(["nobody"]);
  });

  it("matches a custom person field holding a single id", () => {
    const tasks = [
      makeTask({ id: "reported-by-a", fieldValues: { field_reporter: "user-a" } }),
      makeTask({ id: "reported-by-b", fieldValues: { field_reporter: ["user-b"] } }),
      makeTask({ id: "no-reporter" }),
    ];
    const result = applyOne(tasks, {
      id: "c1",
      fieldId: "field_reporter",
      operator: "equals",
      value: ["user-a", "user-b"],
    });
    expect(ids(result)).toEqual(["reported-by-a", "reported-by-b"]);
  });
});

describe("applyFilters - incomplete conditions", () => {
  it("a select condition without a value does not narrow the list", () => {
    const tasks = [
      makeTask({ id: "todo", status: "status_todo" }),
      makeTask({ id: "done", status: "status_done" }),
    ];
    const result = applyOne(tasks, {
      id: "c1",
      fieldId: SYSTEM_FIELD_IDS.STATUS,
      operator: "equals",
      value: null,
    });
    expect(result.map((t) => t.id)).toEqual(["todo", "done"]);
  });
});
