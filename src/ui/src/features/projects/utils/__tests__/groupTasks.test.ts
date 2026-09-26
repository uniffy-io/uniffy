import { describe, expect, it } from "vitest";
import { SortDirection, TaskPseudoField as Pseudo } from "@uniffy/proto/projects/v1/projects_pb";
import {
  DEFAULT_PRIORITY_OPTIONS,
  DEFAULT_STATUS_OPTIONS,
  SYSTEM_FIELD_IDS,
  type FieldDefinition,
  type SelectOption,
} from "@/features/projects/types";
import type { Sprint, Task } from "@/features/projects/types/project";
import type {
  ViewCatalog,
  ViewFieldCapabilities,
  ViewFieldRef,
  ViewGroupBy,
} from "@/features/projects/types/views";
import { buildTaskHierarchyIndex } from "@/features/projects/utils/filterTasks";
import {
  dateBucketOf,
  groupableFields,
  groupSums,
  groupTasks,
  groupWrite,
  type GroupContext,
  type GroupValue,
} from "@/features/projects/utils/groupTasks";
import { statusPaint } from "@/features/projects/utils/statusPaint";
import { fieldRef, pseudoRef } from "@/features/projects/utils/viewFields";
import { makeTask } from "@/features/projects/utils/__tests__/taskFixtures";

function makeField(
  id: string,
  type: FieldDefinition["type"],
  options?: SelectOption[],
  name = id,
): FieldDefinition {
  return {
    id,
    projectId: "proj-1",
    name,
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
  makeField(SYSTEM_FIELD_IDS.TITLE, "text", undefined, "Title"),
  makeField(SYSTEM_FIELD_IDS.STATUS, "single_select", DEFAULT_STATUS_OPTIONS, "Status"),
  makeField(SYSTEM_FIELD_IDS.PRIORITY, "single_select", DEFAULT_PRIORITY_OPTIONS, "Priority"),
  makeField(SYSTEM_FIELD_IDS.ASSIGNEE, "person", undefined, "Assignee"),
  makeField(SYSTEM_FIELD_IDS.START_DATE, "date", undefined, "Start Date"),
  makeField(SYSTEM_FIELD_IDS.DUE_DATE, "date", undefined, "Due Date"),
  makeField("points", "number", undefined, "Points"),
  makeField("reviewer", "person", undefined, "Reviewer"),
  makeField("notes", "text", undefined, "Notes"),
  makeField(
    "size",
    "single_select",
    [
      { id: "size_l", label: "L", color: "#111111", sortOrder: 2 },
      { id: "size_s", label: "S", color: "#222222", sortOrder: 0 },
      { id: "size_m", label: "M", color: "#333333", sortOrder: 1 },
    ],
    "Size",
  ),
  makeField(
    "platforms",
    "multi_select",
    [
      { id: "web", label: "Web", color: "", sortOrder: 0 },
      { id: "ios", label: "iOS", color: "", sortOrder: 1 },
    ],
    "Platforms",
  ),
];
const FIELDS_BY_ID = new Map(FIELDS.map((field) => [field.id, field]));

const GROUPABLE: ViewFieldCapabilities = {
  operators: [],
  idFlags: [],
  sortable: true,
  groupable: true,
};
const NOT_GROUPABLE: ViewFieldCapabilities = { ...GROUPABLE, groupable: false };

const CATALOG: ViewCatalog = {
  fieldTypes: {
    text: NOT_GROUPABLE,
    number: NOT_GROUPABLE,
    single_select: GROUPABLE,
    multi_select: GROUPABLE,
    date: GROUPABLE,
    person: GROUPABLE,
    reference: NOT_GROUPABLE,
  },
  pseudoFields: {
    [Pseudo.TAGS]: GROUPABLE,
    [Pseudo.SPRINT]: GROUPABLE,
    [Pseudo.TASK_TYPE]: GROUPABLE,
    [Pseudo.CREATOR]: GROUPABLE,
    [Pseudo.EPIC]: GROUPABLE,
    [Pseudo.IS_MILESTONE]: GROUPABLE,
    [Pseudo.IS_BLOCKED]: GROUPABLE,
    [Pseudo.HAS_SUBTASKS]: GROUPABLE,
    [Pseudo.CREATED_AT]: GROUPABLE,
    [Pseudo.UPDATED_AT]: GROUPABLE,
    [Pseudo.COMPLETED_AT]: GROUPABLE,
    [Pseudo.PARENT]: NOT_GROUPABLE,
    [Pseudo.NUMBER]: NOT_GROUPABLE,
  },
  filterLimits: {
    maxDepth: 3,
    maxNodes: 50,
    maxIdsPerCondition: 100,
    maxTextLength: 500,
    maxRelativeOffsetDays: 3650,
  },
};

function sprint(id: string, name: string, status: Sprint["status"] = "planned"): Sprint {
  return {
    id,
    projectId: "proj-1",
    organizationId: "org-1",
    name,
    goal: "",
    status,
    startDate: null,
    endDate: null,
    sortOrder: 0,
    taskCount: 0,
    completedTaskCount: 0,
    createdAt: "",
    updatedAt: "",
  };
}

const NAMES = new Map([
  ["user-zoe", "Zoe Adams"],
  ["user-amy", "Amy Brown"],
]);
const TAGS = new Map([
  ["tag-ui", { name: "ui", color: "#ff0000" }],
  ["tag-api", { name: "api" }],
]);

// Wednesday 2026-09-23; weeks start on Monday, so this week is 21..27 and next week 28..10-04.
function context(tasks: Task[], sprints: Sprint[] = []): GroupContext {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return {
    hierarchy: buildTaskHierarchyIndex(tasks),
    fieldsById: FIELDS_BY_ID,
    lookup: (id) => byId.get(id),
    currentUserId: "user-zoe",
    activeSprintId: null,
    today: "2026-09-23",
    weekStartsOn: 1,
    sprints,
    epics: tasks.filter((task) => task.taskType === "epic"),
    tagOf: (id) => TAGS.get(id),
    nameOf: (id) => NAMES.get(id),
  };
}

function by(ref: ViewFieldRef, overrides: Partial<ViewGroupBy> = {}): ViewGroupBy {
  return { field: ref, direction: SortDirection.ASC, hideEmpty: false, ...overrides };
}

function summary(tasks: Task[], groupBy: ViewGroupBy, ctx = context(tasks)) {
  return (groupTasks(tasks, groupBy, ctx) ?? []).map(
    (group) => `${group.label}: ${group.tasks.map((task) => task.id).join(",")}`,
  );
}

describe("groupableFields", () => {
  it("lists the task fields a project always has, then custom fields, from the catalog", () => {
    const labels = groupableFields(FIELDS, CATALOG).map((field) => field.label);
    expect(labels).toEqual([
      "Status",
      "Priority",
      "Assignee",
      "Creator",
      "Tags",
      "Sprint",
      "Type",
      "Due Date",
      "Start Date",
      "Milestone",
      "Epic",
      "Reviewer",
      "Size",
      "Platforms",
      "Blocked",
      "Has subtasks",
      "Created",
      "Updated",
      "Completed",
    ]);
  });

  it("still lists the system fields for a project without custom fields", () => {
    const systemOnly = FIELDS.filter((field) => field.isSystem);
    const labels = groupableFields(systemOnly, CATALOG).map((field) => field.label);
    for (const label of [
      "Status",
      "Priority",
      "Assignee",
      "Creator",
      "Tags",
      "Sprint",
      "Type",
      "Due Date",
      "Milestone",
      "Epic",
    ]) {
      expect(labels).toContain(label);
    }
  });

  it("offers nothing before the catalog loads", () => {
    expect(groupableFields(FIELDS, null)).toEqual([]);
  });
});

describe("groupTasks", () => {
  it("follows option order for selects and paints status through statusPaint", () => {
    const tasks = [
      makeTask({ id: "a", fieldValues: { size: "size_l" } }),
      makeTask({ id: "b", fieldValues: { size: "size_s" } }),
      makeTask({ id: "c", fieldValues: { size: "gone" } }),
    ];
    expect(summary(tasks, by(fieldRef("size")))).toEqual(["S: b", "M: ", "L: a", "No size: c"]);
    const status = groupTasks(tasks, by(fieldRef(SYSTEM_FIELD_IDS.STATUS)), context(tasks))!;
    expect(status[0].color).toBe(
      statusPaint(DEFAULT_STATUS_OPTIONS, DEFAULT_STATUS_OPTIONS[0].id).solid,
    );
  });

  it("puts a task with two assignees under both and an unassigned one last", () => {
    const tasks = [
      makeTask({ id: "a", assigneeIds: ["user-zoe", "user-amy"] }),
      makeTask({ id: "b", assigneeIds: [] }),
      makeTask({ id: "c", assigneeIds: ["user-zoe"] }),
    ];
    expect(summary(tasks, by(fieldRef(SYSTEM_FIELD_IDS.ASSIGNEE)))).toEqual([
      "Amy Brown: a",
      "Zoe Adams: a,c",
      "Unassigned: b",
    ]);
  });

  it("groups tags by name with Untagged last, even when descending", () => {
    const tasks = [
      makeTask({ id: "a", tagIds: ["tag-ui", "tag-api"] }),
      makeTask({ id: "b" }),
      makeTask({ id: "c", tagIds: ["tag-ui"] }),
    ];
    const ref = pseudoRef(Pseudo.TAGS);
    expect(summary(tasks, by(ref))).toEqual(["api: a", "ui: a,c", "Untagged: b"]);
    expect(summary(tasks, by(ref, { direction: SortDirection.DESC }))).toEqual([
      "ui: a,c",
      "api: a",
      "Untagged: b",
    ]);
  });

  it("orders sprints as the project does and keeps closed ones only while they hold tasks", () => {
    const sprints = [
      sprint("s1", "Sprint 1", "closed"),
      sprint("s2", "Sprint 2", "active"),
      sprint("s3", "Sprint 3", "closed"),
    ];
    const tasks = [makeTask({ id: "a", sprintId: "s1" }), makeTask({ id: "b" })];
    expect(summary(tasks, by(pseudoRef(Pseudo.SPRINT)), context(tasks, sprints))).toEqual([
      "Sprint 1: a",
      "Sprint 2: ",
      "Backlog: b",
    ]);
  });

  it("hides empty groups, the none group included, when the view asks", () => {
    const tasks = [makeTask({ id: "a", fieldValues: { size: "size_m" } })];
    expect(summary(tasks, by(fieldRef("size"), { hideEmpty: true }))).toEqual(["M: a"]);
  });

  it("never shows an empty none group for a field no task can leave empty", () => {
    const tasks = [makeTask({ id: "a", taskType: "bug" })];
    const labels = summary(tasks, by(pseudoRef(Pseudo.TASK_TYPE))).map(
      (line) => line.split(":")[0],
    );
    expect(labels).not.toContain("No type");
    expect(labels).toContain("Bug");
  });

  it("groups by the nearest epic, an epic under itself", () => {
    const tasks = [
      makeTask({ id: "e1", taskType: "epic", title: "Billing", sortOrder: 1 }),
      makeTask({ id: "e2", taskType: "epic", title: "Search", sortOrder: 0 }),
      makeTask({ id: "story", taskType: "story", parentId: "e1" }),
      makeTask({ id: "sub", parentId: "story" }),
      makeTask({ id: "loose" }),
    ];
    expect(summary(tasks, by(pseudoRef(Pseudo.EPIC)))).toEqual([
      "Search: e2",
      "Billing: e1,story,sub",
      "No epic: loose",
    ]);
  });

  it("splits flags into yes and no groups", () => {
    const tasks = [makeTask({ id: "a", isMilestone: true }), makeTask({ id: "b" })];
    expect(summary(tasks, by(pseudoRef(Pseudo.IS_MILESTONE)))).toEqual([
      "Milestone: a",
      "Not a milestone: b",
    ]);
  });

  it("buckets due dates like the Overdue preset: unfinished past dates only", () => {
    const tasks = [
      makeTask({ id: "late", dueDate: "2026-09-20" }),
      makeTask({ id: "done", dueDate: "2026-09-20", completedAt: "2026-09-21T10:00:00Z" }),
      makeTask({ id: "today", dueDate: "2026-09-23" }),
      makeTask({ id: "sunday", dueDate: "2026-09-27" }),
      makeTask({ id: "next", dueDate: "2026-10-04" }),
      makeTask({ id: "later", dueDate: "2026-10-05" }),
      makeTask({ id: "none" }),
    ];
    expect(summary(tasks, by(fieldRef(SYSTEM_FIELD_IDS.DUE_DATE), { hideEmpty: true }))).toEqual([
      "Overdue: late",
      "Earlier: done",
      "Today: today",
      "Later this week: sunday",
      "Next week: next",
      "Later: later",
      "No date: none",
    ]);
  });

  it("has no Overdue bucket for other date fields", () => {
    const tasks = [makeTask({ id: "a", startDate: "2026-09-01" })];
    expect(summary(tasks, by(fieldRef(SYSTEM_FIELD_IDS.START_DATE)))[0]).toBe("Earlier: a");
  });

  it("buckets timestamps backwards from the viewer's day", () => {
    const ctx = { today: "2026-09-23", weekStartsOn: 1 as const };
    expect(dateBucketOf("2026-09-23", true, false, ctx)).toBe("today");
    expect(dateBucketOf("2026-09-22", true, false, ctx)).toBe("yesterday");
    expect(dateBucketOf("2026-09-21", true, false, ctx)).toBe("earlier_this_week");
    expect(dateBucketOf("2026-09-14", true, false, ctx)).toBe("last_week");
    expect(dateBucketOf("2026-09-13", true, false, ctx)).toBe("earlier");
  });

  it("keeps the incoming order inside a group so the view's sort still applies", () => {
    const tasks = [
      makeTask({ id: "z", priority: "priority_high" }),
      makeTask({ id: "y", priority: "priority_high" }),
    ];
    expect(summary(tasks, by(fieldRef(SYSTEM_FIELD_IDS.PRIORITY)))).toContain("High: z,y");
  });

  it("returns null for a field the project no longer has", () => {
    expect(groupTasks([], by(fieldRef("deleted")), context([]))).toBeNull();
  });
});

describe("groupSums", () => {
  it("sums estimate, time spent and the given number fields, skipping unfilled ones", () => {
    const tasks = [
      makeTask({ id: "a", estimatedMinutes: 90, fieldValues: { points: 3 } }),
      makeTask({ id: "b", estimatedMinutes: 30, fieldValues: { points: "5" } }),
    ];
    expect(groupSums(tasks, [FIELDS_BY_ID.get("points")!])).toEqual([
      { key: `pseudo:${Pseudo.ESTIMATED_MINUTES}`, label: "Estimate", total: 120, minutes: true },
      { key: "field:points", label: "Points", total: 8, minutes: false },
    ]);
  });
});

describe("groupWrite", () => {
  const id = (value: string): GroupValue => ({ kind: "id", id: value });
  const none: GroupValue = { kind: "none" };

  it("moves an assignee from the source lane to the target and keeps the others", () => {
    const task = makeTask({ id: "a", assigneeIds: ["user-zoe", "user-amy"] });
    const write = groupWrite(
      fieldRef(SYSTEM_FIELD_IDS.ASSIGNEE),
      task,
      id("user-zoe"),
      id("user-bob"),
      FIELDS_BY_ID,
    );
    expect(write).toEqual({
      kind: "update",
      update: { assigneeIds: ["user-amy", "user-bob"] },
      optimistic: { assigneeIds: ["user-amy", "user-bob"] },
    });
  });

  it("clears the field on a drop into the none lane", () => {
    const task = makeTask({ id: "a", tagIds: ["tag-ui", "tag-api"], sprintId: "s1" });
    expect(groupWrite(pseudoRef(Pseudo.TAGS), task, id("tag-ui"), none, FIELDS_BY_ID)).toEqual({
      kind: "update",
      update: { tagIds: [] },
      optimistic: { tagIds: [] },
    });
    expect(groupWrite(pseudoRef(Pseudo.SPRINT), task, id("s1"), none, FIELDS_BY_ID)).toEqual({
      kind: "update",
      update: { sprintId: null },
      optimistic: { sprintId: null },
    });
  });

  it("adds a tag coming from the untagged lane", () => {
    const task = makeTask({ id: "a" });
    expect(groupWrite(pseudoRef(Pseudo.TAGS), task, none, id("tag-ui"), FIELDS_BY_ID)).toEqual({
      kind: "update",
      update: { tagIds: ["tag-ui"] },
      optimistic: { tagIds: ["tag-ui"] },
    });
  });

  it("writes custom selects through field values and merges them optimistically", () => {
    const task = makeTask({ id: "a", fieldValues: { size: "size_s", points: 2 } });
    expect(groupWrite(fieldRef("size"), task, null, id("size_l"), FIELDS_BY_ID)).toEqual({
      kind: "update",
      update: { fieldValues: { size: "size_l" } },
      optimistic: { fieldValues: { size: "size_l", points: 2 } },
    });
    const multi = makeTask({ id: "b", fieldValues: { platforms: ["web", "ios"] } });
    expect(groupWrite(fieldRef("platforms"), multi, id("web"), none, FIELDS_BY_ID)).toEqual({
      kind: "update",
      update: { fieldValues: { platforms: null } },
      optimistic: { fieldValues: { platforms: null } },
    });
  });

  it("keeps status on its move path and priority on a plain update", () => {
    const task = makeTask({ id: "a" });
    expect(
      groupWrite(fieldRef(SYSTEM_FIELD_IDS.STATUS), task, null, id("status_done"), FIELDS_BY_ID),
    ).toEqual({ kind: "status", status: "status_done" });
    expect(
      groupWrite(
        fieldRef(SYSTEM_FIELD_IDS.PRIORITY),
        task,
        null,
        id("priority_high"),
        FIELDS_BY_ID,
      ),
    ).toEqual({
      kind: "update",
      update: { priority: "priority_high" },
      optimistic: { priority: "priority_high" },
    });
  });

  it("reparents on an epic lane and detaches on the no-epic lane", () => {
    const task = makeTask({ id: "a", parentId: "e1" });
    expect(groupWrite(pseudoRef(Pseudo.EPIC), task, id("e1"), id("e2"), FIELDS_BY_ID)).toEqual({
      kind: "reparent",
      parentId: "e2",
    });
    expect(groupWrite(pseudoRef(Pseudo.EPIC), task, id("e1"), none, FIELDS_BY_ID)).toEqual({
      kind: "reparent",
      parentId: null,
    });
  });

  it("refuses groups nothing can write and ignores a drop onto the same group", () => {
    const task = makeTask({ id: "a", dueDate: "2026-09-20" });
    expect(
      groupWrite(
        fieldRef(SYSTEM_FIELD_IDS.DUE_DATE),
        task,
        { kind: "bucket", bucket: "overdue" },
        { kind: "bucket", bucket: "today" },
        FIELDS_BY_ID,
      ).kind,
    ).toBe("blocked");
    expect(
      groupWrite(pseudoRef(Pseudo.CREATOR), task, null, id("user-amy"), FIELDS_BY_ID).kind,
    ).toBe("blocked");
    expect(groupWrite(pseudoRef(Pseudo.SPRINT), task, id("s1"), id("s1"), FIELDS_BY_ID)).toEqual({
      kind: "none",
    });
  });
});
