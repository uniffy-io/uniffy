import { create } from "@bufbuild/protobuf";
import {
  FieldType,
  SortDirection,
  TaskGroupBySchema,
  TaskPseudoField as Pseudo,
} from "@uniffy/proto/projects/v1/projects_pb";
import type { TaskGroupBy } from "@uniffy/proto/projects/v1/projects_pb";
import {
  ASSIGNEE_FIELD_ID,
  DUE_DATE_FIELD_ID,
  PRIORITY_FIELD_ID,
  STATUS_FIELD_ID,
} from "@features/projects/projectsSerializer";
import type {
  PlainSelectOption,
  SerializedFieldDefinition,
  SerializedSprint,
  SerializedTask,
} from "@features/projects/projectsSerializer";
import { fieldRef, pseudoRef } from "@features/projects/viewDefinition";

export type GroupDimension =
  | { kind: "status" }
  | { kind: "priority" }
  | { kind: "assignee" }
  | { kind: "creator" }
  | { kind: "tags" }
  | { kind: "sprint" }
  | { kind: "taskType" }
  | { kind: "due" }
  | { kind: "select"; fieldId: string }
  | { kind: "multiSelect"; fieldId: string }
  | { kind: "person"; fieldId: string };

/** What dropping a task on a group writes. Null clears the value. */
export type GroupDrop =
  | { kind: "status"; status: string }
  | { kind: "priority"; priority: string }
  | { kind: "sprint"; sprintId: string | null }
  | { kind: "select"; fieldId: string; optionId: string | null };

export interface TaskGroup {
  key: string;
  label: string;
  color?: string;
  tasks: SerializedTask[];
  /** Null where a drop cannot write the group's value: multi-valued or derived dimensions. */
  drop: GroupDrop | null;
}

export interface GroupContext {
  statusOptions: PlainSelectOption[];
  priorityOptions: PlainSelectOption[];
  fields: SerializedFieldDefinition[];
  sprints: SerializedSprint[];
  taskTypes: readonly { value: string; label: string }[];
  nameOf: (subjectId: string) => string;
  /** YYYY-MM-DD in the viewer's zone. */
  today: string;
  /** 0 is Sunday. */
  weekStartsOn: number;
}

export const NONE_GROUP_KEY = "__none__";

const DIMENSION_LABELS: Record<
  Exclude<GroupDimension["kind"], "select" | "multiSelect" | "person">,
  string
> = {
  status: "Status",
  priority: "Priority",
  assignee: "Assignee",
  creator: "Creator",
  tags: "Tags",
  sprint: "Sprint",
  taskType: "Type",
  due: "Due date",
};

/** Dimensions where a task sits in more than one group, so a drop has no single value to write. */
export function isMultiValued(dimension: GroupDimension): boolean {
  return (
    dimension.kind === "assignee" ||
    dimension.kind === "tags" ||
    dimension.kind === "multiSelect" ||
    dimension.kind === "person"
  );
}

const CUSTOM_KINDS: ReadonlyMap<FieldType, "select" | "multiSelect" | "person"> = new Map([
  [FieldType.SINGLE_SELECT, "select"],
  [FieldType.MULTI_SELECT, "multiSelect"],
  [FieldType.PERSON, "person"],
]);

/** Every dimension the phone groups by, custom fields after the built-in ones. */
export function groupDimensions(
  fields: readonly SerializedFieldDefinition[],
): { dimension: GroupDimension; label: string }[] {
  const builtIn = (Object.keys(DIMENSION_LABELS) as (keyof typeof DIMENSION_LABELS)[]).map(
    (kind) => ({ dimension: { kind } as GroupDimension, label: DIMENSION_LABELS[kind] }),
  );
  const custom = fields
    .filter((field) => !field.isSystem && CUSTOM_KINDS.has(field.type))
    .map((field) => ({
      dimension: { kind: CUSTOM_KINDS.get(field.type)!, fieldId: field.id } as GroupDimension,
      label: field.name,
    }));
  return [...builtIn, ...custom];
}

export function dimensionKey(dimension: GroupDimension): string {
  return "fieldId" in dimension ? `${dimension.kind}:${dimension.fieldId}` : dimension.kind;
}

export function groupByFor(dimension: GroupDimension, previous?: TaskGroupBy): TaskGroupBy {
  const field = (() => {
    switch (dimension.kind) {
      case "status":
        return fieldRef(STATUS_FIELD_ID);
      case "priority":
        return fieldRef(PRIORITY_FIELD_ID);
      case "assignee":
        return fieldRef(ASSIGNEE_FIELD_ID);
      case "due":
        return fieldRef(DUE_DATE_FIELD_ID);
      case "creator":
        return pseudoRef(Pseudo.CREATOR);
      case "tags":
        return pseudoRef(Pseudo.TAGS);
      case "sprint":
        return pseudoRef(Pseudo.SPRINT);
      case "taskType":
        return pseudoRef(Pseudo.TASK_TYPE);
      default:
        return fieldRef(dimension.fieldId);
    }
  })();
  return create(TaskGroupBySchema, {
    field,
    direction: previous?.direction ?? SortDirection.ASC,
    hideEmpty: previous?.hideEmpty ?? false,
  });
}

/**
 * Null when the view groups by something the phone does not render (milestone, epic, a
 * timestamp); the table then falls back to status, the way it always grouped.
 */
export function dimensionOf(
  groupBy: TaskGroupBy | undefined,
  fields: readonly SerializedFieldDefinition[],
): GroupDimension | null {
  const ref = groupBy?.field?.ref;
  if (!ref) return null;
  if (ref.case === "pseudo") {
    switch (ref.value) {
      case Pseudo.CREATOR:
        return { kind: "creator" };
      case Pseudo.TAGS:
        return { kind: "tags" };
      case Pseudo.SPRINT:
        return { kind: "sprint" };
      case Pseudo.TASK_TYPE:
        return { kind: "taskType" };
      default:
        return null;
    }
  }
  if (ref.case !== "fieldId") return null;
  switch (ref.value) {
    case STATUS_FIELD_ID:
      return { kind: "status" };
    case PRIORITY_FIELD_ID:
      return { kind: "priority" };
    case ASSIGNEE_FIELD_ID:
      return { kind: "assignee" };
    case DUE_DATE_FIELD_ID:
      return { kind: "due" };
  }
  const field = fields.find((f) => f.id === ref.value);
  const kind = field && !field.isSystem ? CUSTOM_KINDS.get(field.type) : undefined;
  return kind ? { kind, fieldId: ref.value } : null;
}

/** Custom list values arrive JSON-encoded; a bare id is a one-element list. */
export function parseIdList(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed))
      return parsed.filter((v): v is string => typeof v === "string" && v.length > 0);
    if (typeof parsed === "string") return parsed ? [parsed] : [];
  } catch {
    // Not JSON: a plain id.
  }
  return [raw];
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekStart(iso: string, weekStartsOn: number): string {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, -((day - weekStartsOn + 7) % 7));
}

const DUE_BUCKETS = [
  { key: "overdue", label: "Overdue" },
  { key: "earlier", label: "Earlier" },
  { key: "today", label: "Today" },
  { key: "thisWeek", label: "This week" },
  { key: "nextWeek", label: "Next week" },
  { key: "later", label: "Later" },
] as const;

/** Due dates are plain `YYYY-MM-DD`, so they compare as strings in the viewer's own calendar. */
function dueBucket(task: SerializedTask, ctx: GroupContext): string {
  const due = task.dueDate;
  if (!due) return NONE_GROUP_KEY;
  if (due < ctx.today) return task.completedAt ? "earlier" : "overdue";
  if (due === ctx.today) return "today";
  const nextWeek = addDays(weekStart(ctx.today, ctx.weekStartsOn), 7);
  if (due < nextWeek) return "thisWeek";
  if (due < addDays(nextWeek, 7)) return "nextWeek";
  return "later";
}

interface Bucket {
  key: string;
  label: string;
  color?: string;
  drop: GroupDrop | null;
  /** Kept even with no tasks, so it stays a place to drop a task into. */
  fixed: boolean;
}

function customField(ctx: GroupContext, fieldId: string): SerializedFieldDefinition | undefined {
  return ctx.fields.find((f) => f.id === fieldId);
}

function bucketsFor(dimension: GroupDimension, ctx: GroupContext): Bucket[] {
  const optionBuckets = (options: PlainSelectOption[], drop: (id: string) => GroupDrop | null) =>
    [...options]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((option) => ({
        key: option.id,
        label: option.label,
        color: option.color,
        drop: drop(option.id),
        fixed: true,
      }));
  switch (dimension.kind) {
    case "status":
      return ctx.statusOptions.map((option) => ({
        key: option.id,
        label: option.label,
        color: option.color,
        drop: { kind: "status", status: option.id },
        fixed: true,
      }));
    case "priority":
      return optionBuckets(ctx.priorityOptions, (priority) => ({ kind: "priority", priority }));
    case "sprint":
      return [...ctx.sprints]
        .filter((sprint) => sprint.status !== "closed")
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((sprint) => ({
          key: sprint.id,
          label: sprint.name,
          drop: { kind: "sprint", sprintId: sprint.id },
          fixed: true,
        }));
    case "taskType":
      return ctx.taskTypes.map((type) => ({
        key: type.value,
        label: type.label,
        drop: null,
        fixed: false,
      }));
    case "due":
      return DUE_BUCKETS.map((bucket) => ({ ...bucket, drop: null, fixed: false }));
    case "select": {
      const { fieldId } = dimension;
      return optionBuckets(customField(ctx, fieldId)?.options ?? [], (optionId) => ({
        kind: "select",
        fieldId,
        optionId,
      }));
    }
    case "multiSelect":
      return optionBuckets(customField(ctx, dimension.fieldId)?.options ?? [], () => null).map(
        (bucket) => ({ ...bucket, fixed: false }),
      );
    default:
      return [];
  }
}

function keysOf(task: SerializedTask, dimension: GroupDimension, ctx: GroupContext): string[] {
  const orNone = (keys: string[]) => (keys.length > 0 ? keys : [NONE_GROUP_KEY]);
  switch (dimension.kind) {
    case "status":
      return [task.status];
    case "priority":
      return [task.priority || NONE_GROUP_KEY];
    case "assignee":
      return orNone(task.assigneeIds);
    case "creator":
      return [task.ownerId];
    case "tags":
      return orNone(task.tags.map((tag) => tag.id));
    case "sprint":
      return [task.sprintId || NONE_GROUP_KEY];
    case "taskType":
      return [task.taskType || "task"];
    case "due":
      return [dueBucket(task, ctx)];
    case "select":
      return orNone(parseIdList(task.fieldValues[dimension.fieldId]).slice(0, 1));
    case "multiSelect":
    case "person":
      return orNone(parseIdList(task.fieldValues[dimension.fieldId]));
  }
}

const NONE_LABELS: Partial<Record<GroupDimension["kind"], string>> = {
  assignee: "Unassigned",
  tags: "Untagged",
  sprint: "Backlog",
  due: "No date",
  priority: "No priority",
};

function noneBucket(dimension: GroupDimension): Bucket {
  const drop: GroupDrop | null =
    dimension.kind === "sprint"
      ? { kind: "sprint", sprintId: null }
      : dimension.kind === "select"
        ? { kind: "select", fieldId: dimension.fieldId, optionId: null }
        : null;
  return {
    key: NONE_GROUP_KEY,
    label: NONE_LABELS[dimension.kind] ?? "None",
    drop,
    fixed: drop !== null,
  };
}

/**
 * Groups keep the order `tasks` arrives in, so the caller's sort carries into every group. A task
 * with several values (assignees, tags, a multi-select) is listed under each of them.
 */
export function buildTaskGroups(
  tasks: readonly SerializedTask[],
  dimension: GroupDimension,
  ctx: GroupContext,
  options: { hideEmpty: boolean; descending: boolean },
): TaskGroup[] {
  const known = bucketsFor(dimension, ctx);
  const byKey = new Map<string, Bucket & { tasks: SerializedTask[] }>(
    known.map((bucket) => [bucket.key, { ...bucket, tasks: [] }]),
  );
  const discovered: (Bucket & { tasks: SerializedTask[] })[] = [];
  const none = { ...noneBucket(dimension), tasks: [] as SerializedTask[] };
  const tags = new Map(tasks.flatMap((task) => task.tags.map((tag) => [tag.id, tag] as const)));
  const sprintNames = new Map(ctx.sprints.map((sprint) => [sprint.id, sprint.name]));

  for (const task of tasks) {
    for (const key of keysOf(task, dimension, ctx)) {
      if (key === NONE_GROUP_KEY) {
        none.tasks.push(task);
        continue;
      }
      let bucket = byKey.get(key);
      if (!bucket) {
        // Values outside the known list: people, tags, a closed sprint, an option deleted in settings.
        if (dimension.kind === "status") continue;
        const tag = tags.get(key);
        const label =
          dimension.kind === "tags"
            ? (tag?.name ?? "Unknown tag")
            : dimension.kind === "sprint"
              ? (sprintNames.get(key) ?? "Unknown sprint")
              : dimension.kind === "assignee" ||
                  dimension.kind === "creator" ||
                  dimension.kind === "person"
                ? ctx.nameOf(key)
                : "Unknown";
        bucket = { key, label, color: tag?.color, drop: null, fixed: false, tasks: [] };
        byKey.set(key, bucket);
        discovered.push(bucket);
      }
      bucket.tasks.push(task);
    }
  }

  discovered.sort((a, b) => a.label.localeCompare(b.label));
  const ordered = [...known.map((bucket) => byKey.get(bucket.key)!), ...discovered];
  if (options.descending) ordered.reverse();
  // The empty-value group stays last in both directions, as empty values sort last on the server.
  const all = none.tasks.length > 0 || none.fixed ? [...ordered, none] : ordered;
  return all
    .filter((group) => group.tasks.length > 0 || (group.fixed && !options.hideEmpty))
    .map(({ key, label, color, tasks: groupTasks, drop }) => ({
      key,
      label,
      color,
      tasks: groupTasks,
      drop,
    }));
}
