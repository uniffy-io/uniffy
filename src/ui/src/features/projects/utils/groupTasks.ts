import {
  RelativeDateAnchor,
  SortDirection,
  TaskPseudoField as Pseudo,
} from "@uniffy/proto/projects/v1/projects_pb";
import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
import type { Subject } from "@/components/subject/types";
import type { FieldDefinition, FieldValue } from "@/features/projects/types/fields";
import type { Sprint, Task, UpdateTaskRequest } from "@/features/projects/types/project";
import type { ViewCatalog, ViewFieldRef, ViewGroupBy } from "@/features/projects/types/views";
import { calendarDayKey } from "@/shared/utils/dateFormatting";
import {
  resolveFilterDate,
  taskRefValue,
  type FilterContext,
} from "@/features/projects/utils/filterTasks";
import { parseMultiSelectValue } from "@/features/projects/utils/multiSelectParsers";
import { statusPaint } from "@/features/projects/utils/statusPaint";
import { getTaskFieldValue, toIdList } from "@/features/projects/utils/taskFieldValue";
import { TASK_TYPES } from "@/features/projects/utils/taskTypes";
import {
  capabilitiesOf,
  fieldKindOf,
  fieldRef,
  fieldRefKey,
  fieldRefLabel,
  isFieldRef,
  isPseudoRef,
  pseudoRef,
  type FieldKind,
} from "@/features/projects/utils/viewFields";

export interface GroupableField {
  ref: ViewFieldRef;
  key: string;
  label: string;
}

/**
 * Every field a view may group by, in menu order: the common task fields first, then custom
 * fields, then the attributes people rarely group by. The catalog decides what qualifies.
 */
export function groupableFields(
  fields: readonly FieldDefinition[],
  catalog: ViewCatalog | null,
): GroupableField[] {
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const custom = fields
    .filter((field) => !field.isSystem)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((field) => fieldRef(field.id));
  const refs: ViewFieldRef[] = [
    fieldRef(SYSTEM_FIELD_IDS.STATUS),
    fieldRef(SYSTEM_FIELD_IDS.PRIORITY),
    fieldRef(SYSTEM_FIELD_IDS.ASSIGNEE),
    pseudoRef(Pseudo.CREATOR),
    pseudoRef(Pseudo.TAGS),
    pseudoRef(Pseudo.SPRINT),
    pseudoRef(Pseudo.TASK_TYPE),
    fieldRef(SYSTEM_FIELD_IDS.DUE_DATE),
    fieldRef(SYSTEM_FIELD_IDS.START_DATE),
    pseudoRef(Pseudo.IS_MILESTONE),
    pseudoRef(Pseudo.EPIC),
    ...custom,
    pseudoRef(Pseudo.IS_BLOCKED),
    pseudoRef(Pseudo.HAS_SUBTASKS),
    pseudoRef(Pseudo.CREATED_AT),
    pseudoRef(Pseudo.UPDATED_AT),
    pseudoRef(Pseudo.COMPLETED_AT),
  ];
  return refs
    .filter((ref) => capabilitiesOf(ref, fieldsById, catalog)?.groupable)
    .map((ref) => ({ ref, key: fieldRefKey(ref), label: fieldRefLabel(ref, fieldsById) }));
}

export type DateBucket =
  | "overdue"
  | "earlier"
  | "last_week"
  | "earlier_this_week"
  | "yesterday"
  | "today"
  | "this_week"
  | "next_week"
  | "later";

/** What a task in the group holds, so a drop onto the group knows what to write. */
export type GroupValue =
  | { kind: "none" }
  | { kind: "id"; id: string }
  | { kind: "flag"; flag: boolean }
  | { kind: "bucket"; bucket: DateBucket };

/** How a group header draws its value next to the label. */
export type GroupDisplay = "plain" | "swatch" | "person" | "task_type" | "epic";

export interface TaskGroup {
  subject?: Subject;
  key: string;
  label: string;
  value: GroupValue;
  display: GroupDisplay;
  /** Swatch for select options and tags; status options read `statusPaint`. */
  color?: string;
  tasks: Task[];
}

export interface GroupContext extends FilterContext {
  sprints: readonly Sprint[];
  /** Every epic of the project, so an epic whose tasks are all filtered out still has a group. */
  epics: readonly Task[];
  tagOf: (id: string) => { name: string; color?: string } | undefined;
  nameOf: (id: string) => string | undefined;
}

interface Seed {
  key: string;
  label: string;
  value: GroupValue;
  display: GroupDisplay;
  color?: string;
}

interface Grouping {
  /** Null when groups come only from the values tasks hold (people, tags). */
  vocabulary: Seed[] | null;
  seedFor: (key: string) => Seed;
  keysOf: (task: Task) => string[];
  none: { key: string; label: string };
  /** A field no task can leave empty never shows an empty "none" group. */
  canBeEmpty: boolean;
}

const NONE_KEY = "__none__";

function idSeed(key: string, label: string, display: GroupDisplay, color?: string): Seed {
  return { key, label, value: { kind: "id", id: key }, display, color };
}

function byLabel(a: Seed, b: Seed): number {
  return a.label.localeCompare(b.label) || a.key.localeCompare(b.key);
}

function selectGrouping(field: FieldDefinition, multi: boolean): Grouping {
  const options = [...(field.config.options ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const known = new Set(options.map((option) => option.id));
  const isStatus = field.id === SYSTEM_FIELD_IDS.STATUS;
  const vocabulary = options.map((option) =>
    idSeed(
      option.id,
      option.label,
      "swatch",
      isStatus ? statusPaint(options, option.id).solid : option.color || undefined,
    ),
  );
  return {
    vocabulary,
    seedFor: (key) => idSeed(key, key, "swatch"),
    keysOf: (task) => {
      const raw = getTaskFieldValue(task, field.id);
      const ids = multi ? parseMultiSelectValue(raw) : typeof raw === "string" ? [raw] : [];
      return ids.filter((id) => known.has(id));
    },
    none: { key: NONE_KEY, label: `No ${field.name.toLowerCase()}` },
    canBeEmpty: true,
  };
}

function personGrouping(
  ref: ViewFieldRef,
  label: string,
  ctx: GroupContext,
  isCreator: boolean,
): Grouping {
  return {
    vocabulary: null,
    seedFor: (key) => idSeed(key, ctx.nameOf(key) ?? "Unknown person", "person"),
    keysOf: (task) => toIdList(taskRefValue(task, ref, ctx)),
    none: {
      key: "__unassigned__",
      label: isFieldRef(ref, SYSTEM_FIELD_IDS.ASSIGNEE)
        ? "Unassigned"
        : `No ${label.toLowerCase()}`,
    },
    canBeEmpty: !isCreator,
  };
}

function tagGrouping(ctx: GroupContext): Grouping {
  return {
    vocabulary: null,
    seedFor: (key) => {
      const tag = ctx.tagOf(key);
      return idSeed(key, tag?.name ?? "Unknown tag", "swatch", tag?.color || undefined);
    },
    keysOf: (task) => task.tagIds ?? [],
    none: { key: "__untagged__", label: "Untagged" },
    canBeEmpty: true,
  };
}

function sprintGrouping(tasks: readonly Task[], ctx: GroupContext): Grouping {
  const holding = new Set(tasks.map((task) => task.sprintId).filter(Boolean));
  // Closed sprints only earn a group while the view still shows tasks in them.
  const sprints = ctx.sprints.filter(
    (sprint) => sprint.status !== "closed" || holding.has(sprint.id),
  );
  const known = new Set(ctx.sprints.map((sprint) => sprint.id));
  return {
    vocabulary: sprints.map((sprint) => idSeed(sprint.id, sprint.name, "plain")),
    seedFor: (key) => idSeed(key, "Unknown sprint", "plain"),
    keysOf: (task) => (task.sprintId && known.has(task.sprintId) ? [task.sprintId] : []),
    none: { key: "__backlog__", label: "Backlog" },
    canBeEmpty: true,
  };
}

function taskTypeGrouping(): Grouping {
  return {
    vocabulary: TASK_TYPES.map((type) => idSeed(type.value, type.label, "task_type")),
    seedFor: (key) => idSeed(key, key, "task_type"),
    keysOf: (task) => [task.taskType || "task"],
    none: { key: NONE_KEY, label: "No type" },
    canBeEmpty: false,
  };
}

/** The nearest epic: the task itself when it is one, else its closest epic ancestor. */
export function nearestEpicId(task: Task, ctx: Pick<GroupContext, "hierarchy" | "lookup">) {
  if (task.taskType === "epic") return task.id;
  for (const ancestorId of ctx.hierarchy.ancestorIdsById.get(task.id) ?? []) {
    if (ctx.lookup(ancestorId)?.taskType === "epic") return ancestorId;
  }
  return null;
}

function epicGrouping(ctx: GroupContext): Grouping {
  const epics = [...ctx.epics].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title),
  );
  return {
    vocabulary: epics.map((epic) => idSeed(epic.id, epic.title, "epic")),
    seedFor: (key) => idSeed(key, ctx.lookup(key)?.title ?? "Unknown epic", "epic"),
    keysOf: (task) => {
      const id = nearestEpicId(task, ctx);
      return id ? [id] : [];
    },
    none: { key: "__no_epic__", label: "No epic" },
    canBeEmpty: true,
  };
}

const FLAG_LABELS: ReadonlyMap<Pseudo, [string, string]> = new Map([
  [Pseudo.IS_MILESTONE, ["Milestone", "Not a milestone"]],
  [Pseudo.IS_BLOCKED, ["Blocked", "Not blocked"]],
  [Pseudo.HAS_SUBTASKS, ["Has subtasks", "No subtasks"]],
]);

function flagGrouping(ref: ViewFieldRef, ctx: GroupContext): Grouping {
  const [yes, no] = (ref.kind === "pseudo" && FLAG_LABELS.get(ref.pseudo)) || ["Yes", "No"];
  const seed = (flag: boolean): Seed => ({
    key: String(flag),
    label: flag ? yes : no,
    value: { kind: "flag", flag },
    display: "plain",
  });
  return {
    vocabulary: [seed(true), seed(false)],
    seedFor: (key) => seed(key === "true"),
    keysOf: (task) => [String(taskRefValue(task, ref, ctx) === true)],
    none: { key: NONE_KEY, label: "No value" },
    canBeEmpty: false,
  };
}

const DATE_BUCKET_LABELS: Record<DateBucket, string> = {
  overdue: "Overdue",
  earlier: "Earlier",
  last_week: "Last week",
  earlier_this_week: "Earlier this week",
  yesterday: "Yesterday",
  today: "Today",
  this_week: "Later this week",
  next_week: "Next week",
  later: "Later",
};

function relativeDay(
  anchor: RelativeDateAnchor,
  offsetDays: number,
  ctx: Pick<GroupContext, "today" | "weekStartsOn">,
): string {
  return resolveFilterDate({ kind: "relative", anchor, offsetDays }, ctx);
}

/**
 * Days compare as the viewer's calendar day. Due dates look ahead and call an unfinished past
 * date overdue, the same rule as the Overdue preset; timestamps only ever lie in the past, so
 * they bucket backwards from today instead.
 */
export function dateBucketOf(
  day: string,
  pastFacing: boolean,
  overdueApplies: boolean,
  ctx: Pick<GroupContext, "today" | "weekStartsOn">,
): DateBucket {
  const today = ctx.today;
  const startOfWeek = relativeDay(RelativeDateAnchor.START_OF_WEEK, 0, ctx);
  if (pastFacing) {
    if (day >= today) return "today";
    if (day === relativeDay(RelativeDateAnchor.TODAY, -1, ctx)) return "yesterday";
    if (day >= startOfWeek) return "earlier_this_week";
    if (day >= relativeDay(RelativeDateAnchor.START_OF_WEEK, -7, ctx)) return "last_week";
    return "earlier";
  }
  if (day < today) return overdueApplies ? "overdue" : "earlier";
  if (day === today) return "today";
  const endOfWeek = relativeDay(RelativeDateAnchor.END_OF_WEEK, 0, ctx);
  if (day <= endOfWeek) return "this_week";
  if (day <= relativeDay(RelativeDateAnchor.END_OF_WEEK, 7, ctx)) return "next_week";
  return "later";
}

function dateGrouping(ref: ViewFieldRef, pastFacing: boolean, ctx: GroupContext): Grouping {
  const isDue = isFieldRef(ref, SYSTEM_FIELD_IDS.DUE_DATE);
  const order: DateBucket[] = pastFacing
    ? ["earlier", "last_week", "earlier_this_week", "yesterday", "today"]
    : [
        ...(isDue ? (["overdue"] as const) : []),
        "earlier",
        "today",
        "this_week",
        "next_week",
        "later",
      ];
  const seed = (bucket: DateBucket): Seed => ({
    key: `date:${bucket}`,
    label: DATE_BUCKET_LABELS[bucket],
    value: { kind: "bucket", bucket },
    display: "plain",
  });
  return {
    vocabulary: order.map(seed),
    seedFor: (key) => seed(key.slice("date:".length) as DateBucket),
    keysOf: (task) => {
      const raw = taskRefValue(task, ref, ctx);
      if (typeof raw !== "string" || !raw) return [];
      const overdue = isDue && !task.completedAt;
      return [`date:${dateBucketOf(calendarDayKey(raw), pastFacing, overdue, ctx)}`];
    },
    none: { key: NONE_KEY, label: "No date" },
    canBeEmpty: !(isPseudoRef(ref, Pseudo.CREATED_AT) || isPseudoRef(ref, Pseudo.UPDATED_AT)),
  };
}

function groupingFor(
  ref: ViewFieldRef,
  kind: FieldKind,
  tasks: readonly Task[],
  ctx: GroupContext,
): Grouping | null {
  const label = fieldRefLabel(ref, ctx.fieldsById);
  const field = ref.kind === "field" ? ctx.fieldsById.get(ref.fieldId) : undefined;
  switch (kind) {
    case "single_select":
    case "multi_select":
      return field ? selectGrouping(field, kind === "multi_select") : null;
    case "person":
    case "single_person":
      return personGrouping(ref, label, ctx, isPseudoRef(ref, Pseudo.CREATOR));
    case "tags":
      return tagGrouping(ctx);
    case "sprint":
      return sprintGrouping(tasks, ctx);
    case "task_type":
      return taskTypeGrouping();
    case "epic":
      return epicGrouping(ctx);
    case "boolean":
      return flagGrouping(ref, ctx);
    case "date":
      return dateGrouping(ref, false, ctx);
    case "timestamp":
      return dateGrouping(ref, true, ctx);
    default:
      return null;
  }
}

/**
 * Buckets the tasks a view shows by one field, keeping their order inside each group. A task with
 * several values (assignees, tags, multi-select options) sits in every matching group; one with
 * none sits in the none group, which stays last whatever the direction.
 */
export function groupTasks(
  tasks: readonly Task[],
  groupBy: ViewGroupBy,
  ctx: GroupContext,
): TaskGroup[] | null {
  const kind = fieldKindOf(groupBy.field, ctx.fieldsById);
  const grouping = kind ? groupingFor(groupBy.field, kind, tasks, ctx) : null;
  if (!grouping) return null;

  const buckets = new Map<string, Task[]>();
  const none: Task[] = [];
  for (const task of tasks) {
    const keys = [...new Set(grouping.keysOf(task))];
    if (keys.length === 0) none.push(task);
    for (const key of keys) {
      const bucket = buckets.get(key);
      if (bucket) bucket.push(task);
      else buckets.set(key, [task]);
    }
  }

  let seeds: Seed[];
  if (grouping.vocabulary) {
    const listed = new Set(grouping.vocabulary.map((seed) => seed.key));
    const strays = [...buckets.keys()].filter((key) => !listed.has(key)).map(grouping.seedFor);
    seeds = [...grouping.vocabulary, ...strays];
  } else {
    seeds = [...buckets.keys()].map(grouping.seedFor).sort(byLabel);
  }

  let groups: TaskGroup[] = seeds.map((seed) => ({ ...seed, tasks: buckets.get(seed.key) ?? [] }));
  if (groupBy.hideEmpty) groups = groups.filter((group) => group.tasks.length > 0);
  if (groupBy.direction === SortDirection.DESC) groups.reverse();
  if (none.length > 0 || (!groupBy.hideEmpty && grouping.canBeEmpty)) {
    groups.push({
      key: grouping.none.key,
      label: grouping.none.label,
      value: { kind: "none" },
      display: "plain",
      tasks: none,
    });
  }
  return groups;
}

export interface GroupSum {
  key: string;
  label: string;
  total: number;
  /** Estimate and time spent are minutes and read as durations. */
  minutes: boolean;
}

interface Summand {
  key: string;
  label: string;
  minutes: boolean;
  read: (task: Task) => unknown;
}

const MINUTE_SUMMANDS: readonly Summand[] = [
  {
    key: fieldRefKey(pseudoRef(Pseudo.ESTIMATED_MINUTES)),
    label: "Estimate",
    minutes: true,
    read: (task) => task.estimatedMinutes,
  },
  {
    key: fieldRefKey(pseudoRef(Pseudo.TIME_SPENT_MINUTES)),
    label: "Spent",
    minutes: true,
    read: (task) => task.timeSpentMinutes,
  },
];

/** Estimate and time spent, then each given number field; a field no task fills adds no sum. */
export function groupSums(
  tasks: readonly Task[],
  numberFields: readonly FieldDefinition[],
): GroupSum[] {
  const summands: Summand[] = [
    ...MINUTE_SUMMANDS,
    ...numberFields.map((field) => ({
      key: fieldRefKey(fieldRef(field.id)),
      label: field.name,
      minutes: false,
      read: (task: Task) => getTaskFieldValue(task, field.id),
    })),
  ];
  const sums: GroupSum[] = [];
  for (const { key, label, minutes, read } of summands) {
    let total = 0;
    let filled = false;
    for (const task of tasks) {
      const raw = read(task);
      const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
      if (typeof value === "number" && Number.isFinite(value)) {
        total += value;
        filled = true;
      }
    }
    if (filled) sums.push({ key, label, total, minutes });
  }
  return sums;
}

/** What dropping a task onto another group asks for. */
export type GroupWrite =
  | { kind: "none" }
  | { kind: "blocked"; reason: string }
  | { kind: "status"; status: string }
  | { kind: "reparent"; parentId: string | null }
  | {
      kind: "update";
      update: Omit<UpdateTaskRequest, "id">;
      optimistic: Partial<Task>;
    };

function sameValue(a: GroupValue | null, b: GroupValue): boolean {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === "id" && b.kind === "id") return a.id === b.id;
  if (a.kind === "flag" && b.kind === "flag") return a.flag === b.flag;
  if (a.kind === "bucket" && b.kind === "bucket") return a.bucket === b.bucket;
  return true;
}

/** A drop between multi-value groups moves the value: the source group's goes, the target's comes. */
function movedIds(current: readonly string[], from: GroupValue | null, to: GroupValue): string[] {
  if (to.kind === "none") return [];
  if (to.kind !== "id") return [...current];
  const kept = from?.kind === "id" ? current.filter((id) => id !== from.id) : [...current];
  return kept.includes(to.id) ? kept : [...kept, to.id];
}

function fieldUpdate(task: Task, fieldId: string, value: FieldValue): GroupWrite {
  return {
    kind: "update",
    update: { fieldValues: { [fieldId]: value } },
    optimistic: { fieldValues: { ...task.fieldValues, [fieldId]: value } },
  };
}

/**
 * The write that puts `task` into the group holding `to`, coming from the group holding `from`
 * (null when the source is not a group, as with board columns). Status keeps its move semantics;
 * values nothing can set (dates, creator, computed flags) are refused with the reason.
 */
export function groupWrite(
  ref: ViewFieldRef,
  task: Task,
  from: GroupValue | null,
  to: GroupValue,
  fieldsById: ReadonlyMap<string, FieldDefinition>,
): GroupWrite {
  if (sameValue(from, to)) return { kind: "none" };
  const label = fieldRefLabel(ref, fieldsById);
  const blocked: GroupWrite = {
    kind: "blocked",
    reason: `Tasks cannot be moved between ${label.toLowerCase()} groups`,
  };
  const kind = fieldKindOf(ref, fieldsById);
  if (!kind || to.kind === "flag" || to.kind === "bucket") return blocked;
  const id = to.kind === "id" ? to.id : null;

  if (ref.kind === "field") {
    const fieldId = ref.fieldId;
    if (fieldId === SYSTEM_FIELD_IDS.STATUS) {
      if (!id) return blocked;
      return id === task.status ? { kind: "none" } : { kind: "status", status: id };
    }
    if (fieldId === SYSTEM_FIELD_IDS.PRIORITY) {
      if (!id) return blocked;
      return id === task.priority
        ? { kind: "none" }
        : { kind: "update", update: { priority: id }, optimistic: { priority: id } };
    }
    if (fieldId === SYSTEM_FIELD_IDS.ASSIGNEE) {
      const assigneeIds = movedIds(task.assigneeIds, from, to);
      return { kind: "update", update: { assigneeIds }, optimistic: { assigneeIds } };
    }
    switch (kind) {
      case "single_select":
        return fieldUpdate(task, fieldId, id);
      case "multi_select": {
        const next = movedIds(parseMultiSelectValue(task.fieldValues[fieldId]), from, to);
        return fieldUpdate(task, fieldId, next.length > 0 ? next : null);
      }
      case "person": {
        const next = movedIds(toIdList(task.fieldValues[fieldId]), from, to);
        return fieldUpdate(task, fieldId, next.length > 0 ? next : null);
      }
      default:
        return blocked;
    }
  }

  switch (ref.pseudo) {
    case Pseudo.TAGS: {
      const tagIds = movedIds(task.tagIds ?? [], from, to);
      return { kind: "update", update: { tagIds }, optimistic: { tagIds } };
    }
    case Pseudo.SPRINT:
      return { kind: "update", update: { sprintId: id }, optimistic: { sprintId: id } };
    case Pseudo.TASK_TYPE:
      if (!id) return blocked;
      return { kind: "update", update: { taskType: id }, optimistic: { taskType: id } };
    case Pseudo.EPIC:
      if (id === task.id) return { kind: "none" };
      return { kind: "reparent", parentId: id };
    default:
      return blocked;
  }
}
