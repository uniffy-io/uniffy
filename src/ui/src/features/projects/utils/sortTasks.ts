import type { FieldDefinition } from "@/features/projects/types";
import type { Task } from "@/features/projects/types/project";
import type { SortConfig } from "@/features/projects/types/views";
import { getTaskFieldValue, toIdList } from "@/features/projects/utils/taskFieldValue";

export interface TaskSortContext {
  fieldsById: ReadonlyMap<string, FieldDefinition>;
  /** Display names for person values; ids missing here sort by the id itself. */
  subjectNameById: ReadonlyMap<string, string>;
}

type SortKey = number | string | null;

const NO_IDS: string[] = [];

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

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

// Values that match no option (the option was deleted) sort with the empties, the same bucket
// the table group-by calls "No value".
function sortKey(
  task: Task,
  field: FieldDefinition,
  order: Map<string, number> | null,
  ctx: TaskSortContext,
): SortKey {
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
    case "person": {
      const [first] = toIdList(value);
      return first ? (ctx.subjectNameById.get(first) ?? first) : null;
    }
    case "number": {
      const number = Number(value);
      return Number.isNaN(number) ? null : number;
    }
    default:
      return String(value);
  }
}

function compareKeys(a: SortKey, b: SortKey, direction: SortConfig["direction"]): number {
  if (a === null || b === null) {
    if (a === b) return 0;
    return a === null ? 1 : -1;
  }
  const comparison =
    typeof a === "number" && typeof b === "number" ? a - b : collator.compare(String(a), String(b));
  return direction === "asc" ? comparison : -comparison;
}

function compareDefault(a: Task, b: Task): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.number - b.number;
}

/** Sorts in place: typed keys per field, empty values last in both directions. */
export function sortTasks(tasks: Task[], sort: SortConfig | null, ctx: TaskSortContext): Task[] {
  const field = sort ? ctx.fieldsById.get(sort.fieldId) : undefined;
  if (!sort || !field) return tasks.sort(compareDefault);

  const order =
    field.type === "single_select" || field.type === "multi_select" ? optionOrder(field) : null;
  const keys = new Map(tasks.map((task) => [task.id, sortKey(task, field, order, ctx)]));

  return tasks.sort(
    (a, b) =>
      compareKeys(keys.get(a.id) ?? null, keys.get(b.id) ?? null, sort.direction) ||
      compareDefault(a, b),
  );
}

/** Ids whose names the active sort needs; a stable empty list otherwise keeps resolver input steady. */
export function personSortIds(
  tasks: Task[],
  sort: SortConfig | null,
  fieldsById: ReadonlyMap<string, FieldDefinition>,
): string[] {
  const field = sort ? fieldsById.get(sort.fieldId) : undefined;
  if (field?.type !== "person") return NO_IDS;

  const ids = new Set<string>();
  for (const task of tasks) {
    const [first] = toIdList(getTaskFieldValue(task, field.id));
    if (first) ids.add(first);
  }
  return [...ids];
}
