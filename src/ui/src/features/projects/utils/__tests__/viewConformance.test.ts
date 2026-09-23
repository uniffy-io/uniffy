import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fromJson, type JsonValue } from "@bufbuild/protobuf";
import { ViewDefinitionSchema } from "@uniffy/proto/projects/v1/projects_pb";
import { protoViewDefinitionToFrontend } from "@/features/projects/api/viewConverters";
import type { FieldDefinition, Sprint } from "@/features/projects/types";
import type { Task } from "@/features/projects/types/project";
import { makeTask } from "@/features/projects/utils/__tests__/taskFixtures";
import {
  applyFilters,
  buildTaskHierarchyIndex,
  type FilterContext,
} from "@/features/projects/utils/filterTasks";
import { sortTasks } from "@/features/projects/utils/sortTasks";
import { setPreferredTimeZone } from "@/shared/utils/timezone";
import { getWeekStartsOn, setPreferredWeekStart } from "@/shared/utils/weekStart";

/**
 * The shared case file the server's SQL is held to as well: both evaluators keep and order the
 * same tasks for every case.
 */
interface CaseFile {
  context: {
    today: string;
    week_start: string;
    time_zone: string;
    current_user: string;
    active_sprint: string;
  };
  users: { id: string; name: string }[];
  sprints: { id: string; status: string }[];
  fields: { id: string; type: FieldDefinition["type"]; options?: string[] }[];
  tasks: {
    id: string;
    title: string;
    task_type?: string;
    status?: string;
    priority?: string;
    parent?: string;
    assignees?: string[];
    tags?: string[];
    sprint?: string;
    due_date?: string;
    completed_at?: string;
    blocked_by?: string[];
    is_milestone?: boolean;
    number: number;
    sort_order: number;
    created_at: string;
    updated_at: string;
    creator: string;
    field_values: Task["fieldValues"];
  }[];
  filters: { name: string; time_zone?: string; filter: JsonValue; expected: string[] }[];
  rejected_filters: { name: string; filter: JsonValue }[];
  sorts: { name: string; sort: JsonValue[]; expected: string[] }[];
}

const CASES: CaseFile = JSON.parse(
  readFileSync(
    new URL("../../../../../../proto/projects/v1/testdata/view_filter_cases.json", import.meta.url),
    "utf8",
  ),
);

const FIELDS: FieldDefinition[] = CASES.fields.map((field, index) => ({
  id: field.id,
  projectId: "proj-1",
  name: field.id,
  type: field.type,
  isRequired: false,
  isSystem: field.id.startsWith("field_"),
  sortOrder: index,
  config: field.options
    ? {
        options: field.options.map((id, order) => ({ id, label: id, color: "", sortOrder: order })),
      }
    : {},
  createdAt: "",
  updatedAt: "",
}));

const SPRINTS = CASES.sprints.map(
  (sprint, index) => ({ id: sprint.id, sortOrder: index, status: sprint.status }) as Sprint,
);

function tasks(): Task[] {
  return CASES.tasks.map((task) =>
    makeTask({
      id: task.id,
      title: task.title,
      taskType: task.task_type ?? "task",
      status: task.status ?? "status_todo",
      priority: task.priority ?? "priority_medium",
      parentId: task.parent ?? null,
      assigneeIds: task.assignees ?? [],
      tagIds: task.tags ?? [],
      sprintId: task.sprint ?? null,
      dueDate: task.due_date ?? null,
      completedAt: task.completed_at ?? null,
      blockedByTaskIds: task.blocked_by ?? [],
      isMilestone: task.is_milestone ?? false,
      number: task.number,
      sortOrder: task.sort_order,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
      ownerId: task.creator,
      fieldValues: task.field_values,
    }),
  );
}

function definition(filter: JsonValue | null, sort: JsonValue[] = []) {
  return protoViewDefinitionToFrontend(
    fromJson(ViewDefinitionSchema, { table: {}, ...(filter ? { filter } : {}), sort }),
  );
}

function context(all: Task[]): FilterContext {
  const byId = new Map(all.map((task) => [task.id, task]));
  return {
    hierarchy: buildTaskHierarchyIndex(all),
    fieldsById: new Map(FIELDS.map((field) => [field.id, field])),
    lookup: (id) => byId.get(id),
    currentUserId: CASES.context.current_user,
    activeSprintId: CASES.context.active_sprint,
    today: CASES.context.today,
    weekStartsOn: getWeekStartsOn(),
  };
}

describe("view filter conformance", () => {
  beforeAll(() => setPreferredWeekStart(CASES.context.week_start));
  afterAll(() => {
    setPreferredTimeZone(null);
    setPreferredWeekStart(null);
  });

  it.each(CASES.filters)("$name", ({ filter, expected, time_zone }) => {
    setPreferredTimeZone(time_zone ?? CASES.context.time_zone);
    const all = tasks();
    const kept = applyFilters(all, definition(filter).filter, context(all));
    expect(kept.map((task) => task.id).sort()).toEqual(expected);
  });

  // The server refuses these outright; the web, holding a view saved before the field went,
  // shows nothing rather than widening the filter.
  it.each(CASES.rejected_filters)("$name keeps nothing", ({ filter }) => {
    setPreferredTimeZone(CASES.context.time_zone);
    const all = tasks();
    expect(applyFilters(all, definition(filter).filter, context(all))).toEqual([]);
  });
});

describe("view sort conformance", () => {
  it.each(CASES.sorts)("$name", ({ sort, expected }) => {
    const all = tasks();
    const ctx = context(all);
    const sorted = sortTasks(all.slice(), definition(null, sort).sort, {
      fieldsById: ctx.fieldsById,
      subjectNameById: new Map(CASES.users.map((user) => [user.id, user.name])),
      sprints: SPRINTS,
      hierarchy: ctx.hierarchy,
      lookup: ctx.lookup,
    });
    expect(sorted.map((task) => task.id)).toEqual(expected);
  });
});
