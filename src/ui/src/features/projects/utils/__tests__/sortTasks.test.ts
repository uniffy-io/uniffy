import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRIORITY_OPTIONS,
  DEFAULT_STATUS_OPTIONS,
  SYSTEM_FIELD_IDS,
  type FieldDefinition,
  type SelectOption,
} from "@/features/projects/types";
import type { Task } from "@/features/projects/types/project";
import type { ViewSortKey } from "@/features/projects/types/views";
import { SortDirection, TaskPseudoField } from "@uniffy/proto/projects/v1/projects_pb";
import { buildTaskHierarchyIndex } from "@/features/projects/utils/filterTasks";
import { fieldRef, pseudoRef } from "@/features/projects/utils/viewFields";
import {
  personSortIds,
  sortTasks,
  type TaskSortContext,
} from "@/features/projects/utils/sortTasks";
import { makeTask } from "@/features/projects/utils/__tests__/taskFixtures";

function makeField(
  id: string,
  type: FieldDefinition["type"],
  options?: SelectOption[],
): FieldDefinition {
  return {
    id,
    projectId: "proj-1",
    name: id,
    type,
    isRequired: false,
    isSystem: id.startsWith("field_"),
    sortOrder: 0,
    config: options ? { options } : {},
    createdAt: "",
    updatedAt: "",
  };
}

const FIELDS: FieldDefinition[] = [
  makeField(SYSTEM_FIELD_IDS.TITLE, "text"),
  makeField(SYSTEM_FIELD_IDS.STATUS, "single_select", DEFAULT_STATUS_OPTIONS),
  makeField(SYSTEM_FIELD_IDS.PRIORITY, "single_select", DEFAULT_PRIORITY_OPTIONS),
  makeField(SYSTEM_FIELD_IDS.ASSIGNEE, "person"),
  makeField(SYSTEM_FIELD_IDS.DUE_DATE, "date"),
  makeField("points", "number"),
  makeField("reporter", "person"),
  makeField("size", "single_select", [
    { id: "size_l", label: "L", color: "", sortOrder: 2 },
    { id: "size_s", label: "S", color: "", sortOrder: 0 },
    { id: "size_m", label: "M", color: "", sortOrder: 1 },
  ]),
  makeField("platforms", "multi_select", [
    { id: "web", label: "Web", color: "", sortOrder: 0 },
    { id: "ios", label: "iOS", color: "", sortOrder: 1 },
    { id: "android", label: "Android", color: "", sortOrder: 2 },
  ]),
];

const NAMES = new Map([
  ["user-zoe", "Zoe Adams"],
  ["user-amy", "amy Brown"],
  ["user-mia", "Mia Clark"],
  ["group-ops", "Ops Team"],
]);

function context(names: ReadonlyMap<string, string> = NAMES, tasks: Task[] = []): TaskSortContext {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return {
    fieldsById: new Map(FIELDS.map((f) => [f.id, f])),
    subjectNameById: names,
    sprints: [],
    hierarchy: buildTaskHierarchyIndex(tasks),
    lookup: (id) => byId.get(id),
  };
}

function sortIds(tasks: Task[], sort: ViewSortKey[] | null, names?: Map<string, string>): string[] {
  return sortTasks(tasks.slice(), sort ?? [], context(names, tasks)).map((t) => t.id);
}

function asc(fieldId: string): ViewSortKey[] {
  return [{ field: fieldRef(fieldId), direction: SortDirection.ASC }];
}

function desc(fieldId: string): ViewSortKey[] {
  return [{ field: fieldRef(fieldId), direction: SortDirection.DESC }];
}

describe("sortTasks - select fields", () => {
  const tasks = [
    makeTask({ id: "done", status: "status_done", number: 1 }),
    makeTask({ id: "progress", status: "status_in_progress", number: 2 }),
    makeTask({ id: "review", status: "status_review", number: 3 }),
    makeTask({ id: "todo", status: "status_todo", number: 4 }),
  ];

  it("orders status by the option order, not by the id", () => {
    expect(sortIds(tasks, asc(SYSTEM_FIELD_IDS.STATUS))).toEqual([
      "todo",
      "progress",
      "review",
      "done",
    ]);
  });

  it("reverses the option order when descending", () => {
    expect(sortIds(tasks, desc(SYSTEM_FIELD_IDS.STATUS))).toEqual([
      "done",
      "review",
      "progress",
      "todo",
    ]);
  });

  it("orders priority low to urgent", () => {
    const byPriority = [
      makeTask({ id: "urgent", priority: "priority_urgent" }),
      makeTask({ id: "high", priority: "priority_high" }),
      makeTask({ id: "low", priority: "priority_low" }),
      makeTask({ id: "medium", priority: "priority_medium" }),
    ];
    expect(sortIds(byPriority, asc(SYSTEM_FIELD_IDS.PRIORITY))).toEqual([
      "low",
      "medium",
      "high",
      "urgent",
    ]);
  });

  it("puts a value that matches no option with the empties", () => {
    const withStale = [
      makeTask({ id: "stale", status: "status_archived" }),
      ...tasks.filter((t) => t.id === "done" || t.id === "todo"),
    ];
    expect(sortIds(withStale, asc(SYSTEM_FIELD_IDS.STATUS))).toEqual(["todo", "done", "stale"]);
    expect(sortIds(withStale, desc(SYSTEM_FIELD_IDS.STATUS))).toEqual(["done", "todo", "stale"]);
  });

  it("orders a custom single select by its option order", () => {
    const sized = [
      makeTask({ id: "large", fieldValues: { size: "size_l" } }),
      makeTask({ id: "small", fieldValues: { size: "size_s" } }),
      makeTask({ id: "unsized" }),
      makeTask({ id: "medium", fieldValues: { size: "size_m" } }),
    ];
    expect(sortIds(sized, asc("size"))).toEqual(["small", "medium", "large", "unsized"]);
  });

  it("orders a multi select by its earliest selected option", () => {
    const platformed = [
      makeTask({ id: "android-only", fieldValues: { platforms: ["android"] } }),
      makeTask({ id: "ios-and-android", fieldValues: { platforms: ["android", "ios"] } }),
      makeTask({ id: "none", fieldValues: { platforms: [] } }),
      makeTask({ id: "web-and-ios", fieldValues: { platforms: ["ios", "web"] } }),
    ];
    expect(sortIds(platformed, asc("platforms"))).toEqual([
      "web-and-ios",
      "ios-and-android",
      "android-only",
      "none",
    ]);
  });
});

describe("sortTasks - person fields", () => {
  const tasks = [
    makeTask({ id: "zoe", assigneeIds: ["user-zoe"] }),
    makeTask({ id: "nobody", assigneeIds: [] }),
    makeTask({ id: "mia-first", assigneeIds: ["user-mia", "user-amy"] }),
    makeTask({ id: "amy", assigneeIds: ["user-amy"] }),
    makeTask({ id: "ops", assigneeIds: ["group-ops"] }),
  ];

  it("orders by the first assignee's display name, case-insensitively", () => {
    expect(sortIds(tasks, asc(SYSTEM_FIELD_IDS.ASSIGNEE))).toEqual([
      "amy",
      "mia-first",
      "ops",
      "zoe",
      "nobody",
    ]);
  });

  it("keeps unassigned tasks last when descending", () => {
    expect(sortIds(tasks, desc(SYSTEM_FIELD_IDS.ASSIGNEE))).toEqual([
      "zoe",
      "ops",
      "mia-first",
      "amy",
      "nobody",
    ]);
  });

  it("falls back to the id for a subject the directory does not know", () => {
    const names = new Map([["user-zoe", "Zoe Adams"]]);
    const unknown = [
      makeTask({ id: "zoe", assigneeIds: ["user-zoe"] }),
      makeTask({ id: "stranger", assigneeIds: ["a-stranger"] }),
    ];
    expect(sortIds(unknown, asc(SYSTEM_FIELD_IDS.ASSIGNEE), names)).toEqual(["stranger", "zoe"]);
  });

  it("reads a custom person field stored as a single id", () => {
    const reported = [
      makeTask({ id: "by-zoe", fieldValues: { reporter: "user-zoe" } }),
      makeTask({ id: "by-amy", fieldValues: { reporter: ["user-amy"] } }),
    ];
    expect(sortIds(reported, asc("reporter"))).toEqual(["by-amy", "by-zoe"]);
  });

  it("asks the resolver only for first assignees and only for person sorts", () => {
    const fieldsById = context().fieldsById;
    expect(personSortIds(tasks, asc(SYSTEM_FIELD_IDS.ASSIGNEE), fieldsById).sort()).toEqual([
      "group-ops",
      "user-amy",
      "user-mia",
      "user-zoe",
    ]);
    const statusIds = personSortIds(tasks, asc(SYSTEM_FIELD_IDS.STATUS), fieldsById);
    expect(statusIds).toEqual([]);
    expect(personSortIds(tasks, [], fieldsById)).toBe(statusIds);
  });
});

describe("sortTasks - scalar fields", () => {
  it("compares numbers numerically with empties last", () => {
    const pointed = [
      makeTask({ id: "ten", fieldValues: { points: 10 } }),
      makeTask({ id: "blank", fieldValues: { points: null } }),
      makeTask({ id: "two", fieldValues: { points: 2 } }),
    ];
    expect(sortIds(pointed, asc("points"))).toEqual(["two", "ten", "blank"]);
    expect(sortIds(pointed, desc("points"))).toEqual(["ten", "two", "blank"]);
  });

  it("compares titles naturally and ignoring case", () => {
    const titled = [
      makeTask({ id: "t10", title: "Task 10" }),
      makeTask({ id: "t2", title: "task 2" }),
      makeTask({ id: "alpha", title: "Alpha" }),
    ];
    expect(sortIds(titled, asc(SYSTEM_FIELD_IDS.TITLE))).toEqual(["alpha", "t2", "t10"]);
  });

  it("orders due dates by calendar day with undated tasks last", () => {
    const dated = [
      makeTask({ id: "october", dueDate: "2026-10-01" }),
      makeTask({ id: "undated", dueDate: null }),
      makeTask({ id: "september", dueDate: "2026-09-17" }),
    ];
    expect(sortIds(dated, asc(SYSTEM_FIELD_IDS.DUE_DATE))).toEqual([
      "september",
      "october",
      "undated",
    ]);
    expect(sortIds(dated, desc(SYSTEM_FIELD_IDS.DUE_DATE))).toEqual([
      "october",
      "september",
      "undated",
    ]);
  });
});

describe("sortTasks - default order", () => {
  const tasks = [
    makeTask({ id: "second", sortOrder: 2, number: 1 }),
    makeTask({ id: "first-b", sortOrder: 1, number: 9 }),
    makeTask({ id: "first-a", sortOrder: 1, number: 3 }),
  ];

  it("uses sort order then number without a sort", () => {
    expect(sortIds(tasks, null)).toEqual(["first-a", "first-b", "second"]);
  });

  it("uses the default order for a field the project no longer has", () => {
    expect(sortIds(tasks, asc("deleted-field"))).toEqual(["first-a", "first-b", "second"]);
  });

  it("breaks ties between equal keys with the default order", () => {
    const tied = tasks.map((t) => ({ ...t, status: "status_todo" }));
    expect(sortIds(tied, desc(SYSTEM_FIELD_IDS.STATUS))).toEqual(["first-a", "first-b", "second"]);
  });
});

describe("sortTasks - several keys and task attributes", () => {
  it("breaks ties on the first key with the second", () => {
    const tasks = [
      makeTask({ id: "todo-low", status: "status_todo", priority: "priority_low" }),
      makeTask({ id: "done-high", status: "status_done", priority: "priority_high" }),
      makeTask({ id: "todo-high", status: "status_todo", priority: "priority_high" }),
    ];
    const keys: ViewSortKey[] = [
      { field: fieldRef(SYSTEM_FIELD_IDS.STATUS), direction: SortDirection.ASC },
      { field: fieldRef(SYSTEM_FIELD_IDS.PRIORITY), direction: SortDirection.DESC },
    ];
    expect(sortIds(tasks, keys)).toEqual(["todo-high", "todo-low", "done-high"]);
  });

  it("orders by task type in the catalog order", () => {
    const tasks = [
      makeTask({ id: "bug", taskType: "bug" }),
      makeTask({ id: "task", taskType: "task" }),
      makeTask({ id: "epic", taskType: "epic" }),
    ];
    const keys = [{ field: pseudoRef(TaskPseudoField.TASK_TYPE), direction: SortDirection.ASC }];
    expect(sortIds(tasks, keys)).toEqual(["task", "bug", "epic"]);
  });

  it("orders by the task number and by blocked tasks first when descending", () => {
    const tasks = [
      makeTask({ id: "blocker", number: 3 }),
      makeTask({ id: "blocked", number: 1, blockedByTaskIds: ["blocker"] }),
      makeTask({ id: "free", number: 2 }),
    ];
    const byNumber = [{ field: pseudoRef(TaskPseudoField.NUMBER), direction: SortDirection.DESC }];
    expect(sortIds(tasks, byNumber)).toEqual(["blocker", "free", "blocked"]);
    const byBlocked = [
      { field: pseudoRef(TaskPseudoField.IS_BLOCKED), direction: SortDirection.DESC },
    ];
    expect(sortIds(tasks, byBlocked)[0]).toBe("blocked");
  });

  it("asks the resolver for creators when sorting by creator", () => {
    const tasks = [makeTask({ id: "a", ownerId: "user-zoe" })];
    const keys = [{ field: pseudoRef(TaskPseudoField.CREATOR), direction: SortDirection.ASC }];
    expect(personSortIds(tasks, keys, context().fieldsById)).toEqual(["user-zoe"]);
  });
});
