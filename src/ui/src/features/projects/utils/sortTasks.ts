import { SortDirection, TaskPseudoField as Pseudo } from "@uniffy/proto/projects/v1/projects_pb";
import type { FieldDefinition, Sprint } from "@/features/projects/types";
import type { Task } from "@/features/projects/types/project";
import type { ViewFieldRef, ViewSortKey } from "@/features/projects/types/views";
import { calendarDayKey } from "@/shared/utils/dateFormatting";
import { getTaskFieldValue, toIdList } from "@/features/projects/utils/taskFieldValue";
import { TASK_TYPES } from "@/features/projects/utils/taskTypes";
import { isTaskBlocked, type TaskLookup } from "@/features/projects/utils/taskRelations";
import type { TaskHierarchyIndex } from "@/features/projects/utils/filterTasks";

export interface TaskSortContext {
  fieldsById: ReadonlyMap<string, FieldDefinition>;
  /** Display names for person values; ids missing here sort by the id itself. */
  subjectNameById: ReadonlyMap<string, string>;
  sprints: readonly Sprint[];
  hierarchy: TaskHierarchyIndex;
  lookup: TaskLookup;
}

type SortValue = number | string | null;

const NO_IDS: string[] = [];

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const TASK_TYPE_RANK = new Map(TASK_TYPES.map((type, index) => [type.value, index]));

function isEmpty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function optionOrder(field: FieldDefinition): Map<string, number> {
  return new Map((field.config.options ?? []).map((option) => [option.id, option.sortOrder]));
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isNaN(number) ? null : number;
}

function personName(value: unknown, ctx: TaskSortContext): string | null {
  const [first] = toIdList(value);
  return first ? (ctx.subjectNameById.get(first) ?? first) : null;
}

function pseudoSortValue(task: Task, pseudo: Pseudo, ctx: TaskSortContext): SortValue {
  switch (pseudo) {
    case Pseudo.SPRINT: {
      const index = ctx.sprints.findIndex((sprint) => sprint.id === task.sprintId);
      return index === -1 ? null : index;
    }
    case Pseudo.TASK_TYPE:
      return TASK_TYPE_RANK.get(task.taskType || "task") ?? null;
    case Pseudo.CREATOR:
      return personName(task.ownerId, ctx);
    case Pseudo.DEPTH:
      return ctx.hierarchy.depthById.get(task.id) ?? 0;
    case Pseudo.HAS_SUBTASKS:
      return ctx.hierarchy.hasChildren.has(task.id) || task.subtaskTotal > 0 ? 1 : 0;
    case Pseudo.IS_MILESTONE:
      return task.isMilestone ? 1 : 0;
    case Pseudo.IS_BLOCKED:
      return isTaskBlocked(task, ctx.lookup) ? 1 : 0;
    case Pseudo.CREATED_AT:
      return task.createdAt || null;
    case Pseudo.UPDATED_AT:
      return task.updatedAt || null;
    case Pseudo.COMPLETED_AT:
      return task.completedAt;
    case Pseudo.ESTIMATED_MINUTES:
      return task.estimatedMinutes;
    case Pseudo.TIME_SPENT_MINUTES:
      return task.timeSpentMinutes;
    case Pseudo.NUMBER:
      return task.number;
    default:
      return null;
  }
}

// Values that match no option (the option was deleted) sort with the empties, the same bucket
// the table group-by calls "No value".
function fieldSortValue(
  task: Task,
  field: FieldDefinition,
  order: Map<string, number> | null,
  ctx: TaskSortContext,
): SortValue {
  const value = getTaskFieldValue(task, field.id);
  if (isEmpty(value)) return null;

  switch (field.type) {
    case "single_select":
      return order?.get(String(value)) ?? null;
    case "multi_select": {
      const known = toIdList(value)
        .map((id) => order?.get(id))
        .filter((rank): rank is number => rank !== undefined);
      return known.length > 0 ? Math.min(...known) : null;
    }
    case "person":
      return personName(value, ctx);
    case "number":
      return numberOrNull(value);
    case "date":
      return calendarDayKey(String(value));
    default:
      return String(value);
  }
}

function compareValues(a: SortValue, b: SortValue, direction: SortDirection): number {
  if (a === null || b === null) {
    if (a === b) return 0;
    return a === null ? 1 : -1;
  }
  const comparison =
    typeof a === "number" && typeof b === "number" ? a - b : collator.compare(String(a), String(b));
  return direction === SortDirection.DESC ? -comparison : comparison;
}

function compareDefault(a: Task, b: Task): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.number - b.number;
}

type Extractor = (task: Task) => SortValue;

function extractorFor(ref: ViewFieldRef, ctx: TaskSortContext): Extractor | null {
  if (ref.kind === "pseudo") return (task) => pseudoSortValue(task, ref.pseudo, ctx);
  const field = ctx.fieldsById.get(ref.fieldId);
  if (!field) return null;
  const order =
    field.type === "single_select" || field.type === "multi_select" ? optionOrder(field) : null;
  return (task) => fieldSortValue(task, field, order, ctx);
}

/** Sorts in place by each key in turn: empty values last in both directions, manual order last. */
export function sortTasks(
  tasks: Task[],
  keys: readonly ViewSortKey[],
  ctx: TaskSortContext,
): Task[] {
  const active = keys
    .map((key) => ({ extract: extractorFor(key.field, ctx), direction: key.direction }))
    .filter((key): key is { extract: Extractor; direction: SortDirection } => key.extract !== null);
  if (active.length === 0) return tasks.sort(compareDefault);

  const values = new Map(tasks.map((task) => [task.id, active.map((key) => key.extract(task))]));
  return tasks.sort((a, b) => {
    const left = values.get(a.id) ?? [];
    const right = values.get(b.id) ?? [];
    for (let index = 0; index < active.length; index += 1) {
      const comparison = compareValues(
        left[index] ?? null,
        right[index] ?? null,
        active[index].direction,
      );
      if (comparison !== 0) return comparison;
    }
    return compareDefault(a, b);
  });
}

/** Ids whose names the active sort needs; a stable empty list otherwise keeps resolver input steady. */
export function personSortIds(
  tasks: Task[],
  keys: readonly ViewSortKey[],
  fieldsById: ReadonlyMap<string, FieldDefinition>,
): string[] {
  const readers = keys
    .map(({ field: ref }) => {
      if (ref.kind === "pseudo") {
        return ref.pseudo === Pseudo.CREATOR ? (task: Task) => task.ownerId : null;
      }
      const field = fieldsById.get(ref.fieldId);
      return field?.type === "person" ? (task: Task) => getTaskFieldValue(task, field.id) : null;
    })
    .filter((reader): reader is (task: Task) => unknown => reader !== null);
  if (readers.length === 0) return NO_IDS;

  const ids = new Set<string>();
  for (const task of tasks) {
    for (const read of readers) {
      const [first] = toIdList(read(task));
      if (first) ids.add(first);
    }
  }
  return [...ids];
}
