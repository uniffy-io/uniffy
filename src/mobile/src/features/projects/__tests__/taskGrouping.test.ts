import { describe, expect, it } from "vitest";
import { FieldType, SortDirection } from "@uniffy/proto/projects/v1/projects_pb";
import type {
  PlainSelectOption,
  SerializedFieldDefinition,
  SerializedSprint,
  SerializedTask,
} from "@features/projects/projectsSerializer";
import {
  buildTaskGroups,
  dimensionOf,
  groupByFor,
  groupDimensions,
  isMultiValued,
  NONE_GROUP_KEY,
  parseIdList,
} from "@features/projects/taskGrouping";
import type { GroupContext, GroupDimension } from "@features/projects/taskGrouping";

function task(id: string, overrides: Partial<SerializedTask> = {}): SerializedTask {
  return {
    id,
    status: "status_todo",
    priority: "priority_low",
    assigneeIds: [],
    tags: [],
    ownerId: "owner",
    taskType: "task",
    dueDate: null,
    fieldValues: {},
    ...overrides,
  } as SerializedTask;
}

const option = (id: string, sortOrder: number): PlainSelectOption => ({
  id,
  label: id,
  color: "#000",
  sortOrder,
});

const sizeField: SerializedFieldDefinition = {
  id: "field_size",
  name: "Size",
  type: FieldType.SINGLE_SELECT,
  isSystem: false,
  options: [option("large", 1), option("small", 0)],
  configJson: "",
};

const labelsField: SerializedFieldDefinition = {
  id: "field_labels",
  name: "Labels",
  type: FieldType.MULTI_SELECT,
  isSystem: false,
  options: [option("red", 0), option("blue", 1)],
  configJson: "",
};

const sprint = (id: string, sortOrder: number, status: SerializedSprint["status"]) =>
  ({ id, name: id, sortOrder, status }) as SerializedSprint;

const ctx: GroupContext = {
  statusOptions: [option("status_todo", 0), option("status_done", 1)],
  priorityOptions: [option("priority_low", 0), option("priority_high", 1)],
  fields: [sizeField, labelsField],
  sprints: [sprint("s2", 1, "planned"), sprint("s1", 0, "active"), sprint("old", 2, "closed")],
  taskTypes: [
    { value: "task", label: "Task" },
    { value: "bug", label: "Bug" },
  ],
  nameOf: (id) => ({ ann: "Ann", bob: "Bob" })[id] ?? "Unknown",
  // A Wednesday; the week starts on Monday the 22nd.
  today: "2026-09-24",
  weekStartsOn: 1,
};

const options = { hideEmpty: false, descending: false };

function summary(dimension: GroupDimension, tasks: SerializedTask[], opts = options) {
  return buildTaskGroups(tasks, dimension, ctx, opts).map((group) => [
    group.label,
    group.tasks.map((t) => t.id),
  ]);
}

describe("task grouping", () => {
  it("keeps every status as a drop target, in option order", () => {
    expect(summary({ kind: "status" }, [task("a", { status: "status_done" })])).toEqual([
      ["status_todo", []],
      ["status_done", ["a"]],
    ]);
  });

  it("lists a task under each assignee and once under Unassigned when it has none", () => {
    const tasks = [task("both", { assigneeIds: ["bob", "ann"] }), task("none")];
    expect(summary({ kind: "assignee" }, tasks)).toEqual([
      ["Ann", ["both"]],
      ["Bob", ["both"]],
      ["Unassigned", ["none"]],
    ]);
  });

  it("puts Untagged last", () => {
    const tasks = [
      task("tagged", { tags: [{ id: "t1", name: "api", color: "#f00" }] }),
      task("bare"),
    ];
    expect(summary({ kind: "tags" }, tasks)).toEqual([
      ["api", ["tagged"]],
      ["Untagged", ["bare"]],
    ]);
  });

  it("orders open sprints and keeps the Backlog lane as a drop target", () => {
    const groups = buildTaskGroups(
      [task("a", { sprintId: "s2" })],
      { kind: "sprint" },
      ctx,
      options,
    );
    expect(groups.map((g) => [g.label, g.tasks.length])).toEqual([
      ["s1", 0],
      ["s2", 1],
      ["Backlog", 0],
    ]);
    expect(groups.at(-1)?.drop).toEqual({ kind: "sprint", sprintId: null });
  });

  it("buckets due dates by the viewer's calendar week", () => {
    const tasks = [
      task("late", { dueDate: "2026-09-20" }),
      task("done-late", { dueDate: "2026-09-20", completedAt: "2026-09-21T10:00:00Z" }),
      task("today", { dueDate: "2026-09-24" }),
      task("sunday", { dueDate: "2026-09-27" }),
      task("next-monday", { dueDate: "2026-09-28" }),
      task("later", { dueDate: "2026-10-05" }),
      task("undated"),
    ];
    expect(summary({ kind: "due" }, tasks)).toEqual([
      ["Overdue", ["late"]],
      ["Earlier", ["done-late"]],
      ["Today", ["today"]],
      ["This week", ["sunday"]],
      ["Next week", ["next-monday"]],
      ["Later", ["later"]],
      ["No date", ["undated"]],
    ]);
  });

  it("groups a custom select by option order and writes the option on drop", () => {
    const groups = buildTaskGroups(
      [task("a", { fieldValues: { field_size: "large" } }), task("b")],
      { kind: "select", fieldId: "field_size" },
      ctx,
      options,
    );
    expect(groups.map((g) => [g.key, g.tasks.map((t) => t.id)])).toEqual([
      ["small", []],
      ["large", ["a"]],
      [NONE_GROUP_KEY, ["b"]],
    ]);
    expect(groups[1].drop).toEqual({ kind: "select", fieldId: "field_size", optionId: "large" });
  });

  it("reads a JSON-encoded multi-select into every matching group", () => {
    const tasks = [task("a", { fieldValues: { field_labels: '["red","blue"]' } })];
    const groups = buildTaskGroups(
      tasks,
      { kind: "multiSelect", fieldId: "field_labels" },
      ctx,
      options,
    );
    expect(groups.map((g) => g.key)).toEqual(["red", "blue"]);
    expect(groups.every((g) => g.drop === null)).toBe(true);
  });

  it("hides empty groups and reverses order on request, keeping the empty value last", () => {
    const tasks = [task("a", { priority: "priority_low" }), task("b", { sprintId: "s1" })];
    expect(summary({ kind: "priority" }, tasks, { hideEmpty: true, descending: false })).toEqual([
      ["priority_low", ["a", "b"]],
    ]);
    expect(
      summary({ kind: "sprint" }, tasks, { hideEmpty: false, descending: true }).map(([l]) => l),
    ).toEqual(["s2", "s1", "Backlog"]);
  });

  it("keeps the order tasks arrive in inside each group", () => {
    const tasks = [task("z"), task("a"), task("m")];
    expect(summary({ kind: "status" }, tasks)[0][1]).toEqual(["z", "a", "m"]);
  });

  it("maps a group-by to a dimension and back", () => {
    for (const { dimension } of groupDimensions(ctx.fields)) {
      expect(dimensionOf(groupByFor(dimension), ctx.fields)).toEqual(dimension);
    }
    const previous = groupByFor({ kind: "status" });
    previous.direction = SortDirection.DESC;
    previous.hideEmpty = true;
    const next = groupByFor({ kind: "tags" }, previous);
    expect([next.direction, next.hideEmpty]).toEqual([SortDirection.DESC, true]);
  });

  it("lists custom select, multi-select and person fields after the built-in dimensions", () => {
    expect(groupDimensions(ctx.fields).map((d) => d.label)).toEqual([
      "Status",
      "Priority",
      "Assignee",
      "Creator",
      "Tags",
      "Sprint",
      "Type",
      "Due date",
      "Size",
      "Labels",
    ]);
    expect(isMultiValued({ kind: "multiSelect", fieldId: "x" })).toBe(true);
    expect(isMultiValued({ kind: "select", fieldId: "x" })).toBe(false);
  });

  it("parses stored id lists", () => {
    expect(parseIdList('["a","b"]')).toEqual(["a", "b"]);
    expect(parseIdList("plain-id")).toEqual(["plain-id"]);
    expect(parseIdList("")).toEqual([]);
  });
});
