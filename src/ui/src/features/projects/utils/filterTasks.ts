import {
  FilterLogic,
  RelativeDateAnchor,
  TaskFilterOperator as Op,
  TaskPseudoField as Pseudo,
} from "@uniffy/proto/projects/v1/projects_pb";
import type { FieldDefinition, Task } from "@/features/projects/types";
import type {
  ViewFieldRef,
  ViewFilterCondition,
  ViewFilterDate,
  ViewFilterGroup,
  ViewFilterIdSet,
} from "@/features/projects/types/views";
import { calendarDayKey } from "@/shared/utils/dateFormatting";
import type { WeekStartDay } from "@/shared/utils/weekStart";
import { getTaskFieldValue, toIdList } from "@/features/projects/utils/taskFieldValue";
import { isTaskBlocked, type TaskLookup } from "@/features/projects/utils/taskRelations";
import { fieldKindOf, type FieldKind } from "@/features/projects/utils/viewFields";

export interface TaskHierarchyIndex {
  depthById: Map<string, number>;
  ancestorIdsById: Map<string, Set<string>>;
  hasChildren: Set<string>;
}

/** Cycles in parent_id are tolerated: each chain stops at MAX_DEPTH or on repeat. */
export function buildTaskHierarchyIndex(tasks: Task[]): TaskHierarchyIndex {
  const parentById = new Map<string, string | null>();
  const hasChildren = new Set<string>();
  for (const t of tasks) {
    parentById.set(t.id, t.parentId ?? null);
    if (t.parentId) hasChildren.add(t.parentId);
  }

  const depthById = new Map<string, number>();
  const ancestorIdsById = new Map<string, Set<string>>();
  const MAX_DEPTH = 64;

  for (const t of tasks) {
    const ancestors = new Set<string>();
    let depth = 0;
    let currentParent = t.parentId ?? null;
    while (currentParent && depth < MAX_DEPTH && !ancestors.has(currentParent)) {
      ancestors.add(currentParent);
      depth += 1;
      currentParent = parentById.get(currentParent) ?? null;
    }
    depthById.set(t.id, depth);
    ancestorIdsById.set(t.id, ancestors);
  }

  return { depthById, ancestorIdsById, hasChildren };
}

export interface FilterContext {
  hierarchy: TaskHierarchyIndex;
  fieldsById: ReadonlyMap<string, FieldDefinition>;
  /** Every loaded task, so epics and blockers outside the filtered set still resolve. */
  lookup: TaskLookup;
  currentUserId: string | null;
  activeSprintId: string | null;
  /** The viewer's calendar day, YYYY-MM-DD; relative dates and timestamps resolve against it. */
  today: string;
  weekStartsOn: WeekStartDay;
}

type Value = string | number | boolean | string[] | null;

function isEmptyValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** Ids of the epics a task sits in: itself when it is one, then every epic ancestor. */
export function epicIdsOf(task: Task, ctx: Pick<FilterContext, "hierarchy" | "lookup">): string[] {
  const ids = task.taskType === "epic" ? [task.id] : [];
  for (const ancestorId of ctx.hierarchy.ancestorIdsById.get(task.id) ?? []) {
    if (ctx.lookup(ancestorId)?.taskType === "epic") ids.push(ancestorId);
  }
  return ids;
}

function pseudoValue(task: Task, pseudo: Pseudo, ctx: FilterContext): Value {
  switch (pseudo) {
    case Pseudo.TAGS:
      return task.tagIds ?? [];
    case Pseudo.SPRINT:
      return task.sprintId;
    case Pseudo.TASK_TYPE:
      return task.taskType || "task";
    case Pseudo.CREATOR:
      return task.ownerId;
    case Pseudo.PARENT:
      return task.parentId;
    case Pseudo.EPIC:
      return epicIdsOf(task, ctx);
    case Pseudo.HAS_SUBTASKS:
      return ctx.hierarchy.hasChildren.has(task.id) || task.subtaskTotal > 0;
    case Pseudo.DEPTH:
      return ctx.hierarchy.depthById.get(task.id) ?? 0;
    case Pseudo.IS_MILESTONE:
      return task.isMilestone;
    case Pseudo.IS_BLOCKED:
      return isTaskBlocked(task, ctx.lookup);
    case Pseudo.BLOCKED_BY:
      return task.blockedByTaskIds;
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

export function taskRefValue(task: Task, ref: ViewFieldRef, ctx: FilterContext): Value {
  if (ref.kind === "pseudo") return pseudoValue(task, ref.pseudo, ctx);
  return (getTaskFieldValue(task, ref.fieldId) as Value | undefined) ?? null;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function dayKeyOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDayKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(key: string, days: number): string {
  const date = parseDayKey(key);
  date.setUTCDate(date.getUTCDate() + days);
  return dayKeyOf(date);
}

/** Day arithmetic runs on UTC midnights so a DST change never shifts a relative date. */
export function resolveFilterDate(
  date: ViewFilterDate,
  ctx: Pick<FilterContext, "today" | "weekStartsOn">,
): string {
  if (date.kind === "fixed") return date.date;
  const today = parseDayKey(ctx.today);
  let anchor = ctx.today;
  switch (date.anchor) {
    case RelativeDateAnchor.START_OF_WEEK:
    case RelativeDateAnchor.END_OF_WEEK: {
      const sinceStart = (today.getUTCDay() - ctx.weekStartsOn + 7) % 7;
      const start = addDays(ctx.today, -sinceStart);
      anchor = date.anchor === RelativeDateAnchor.START_OF_WEEK ? start : addDays(start, 6);
      break;
    }
    case RelativeDateAnchor.START_OF_MONTH:
      anchor = dayKeyOf(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
      break;
    case RelativeDateAnchor.END_OF_MONTH: {
      const year = today.getUTCFullYear();
      const month = today.getUTCMonth();
      anchor = dayKeyOf(new Date(Date.UTC(year, month, daysInMonth(year, month))));
      break;
    }
  }
  return addDays(anchor, date.offsetDays);
}

function wantedIds(set: ViewFilterIdSet, ctx: FilterContext): string[] {
  const ids = [...set.ids];
  if (set.includeCurrentUser && ctx.currentUserId) ids.push(ctx.currentUserId);
  if (set.includeActiveSprint && ctx.activeSprintId) ids.push(ctx.activeSprintId);
  return ids;
}

function matchIds(have: string[], condition: ViewFilterCondition, ctx: FilterContext): boolean {
  const value = condition.value;
  if (value?.kind !== "ids") return true;
  const wanted = wantedIds(value.ids, ctx);
  const emptyMatches = value.ids.includeEmpty && have.length === 0;
  const anyOf = emptyMatches || wanted.some((id) => have.includes(id));
  switch (condition.operator) {
    case Op.IS:
    case Op.IS_ANY_OF:
      return anyOf;
    case Op.IS_NOT:
    case Op.IS_NONE_OF:
      return !anyOf;
    case Op.IS_ALL_OF:
      return wanted.length > 0 && wanted.every((id) => have.includes(id));
    default:
      return true;
  }
}

function matchText(raw: Value, condition: ViewFilterCondition): boolean {
  if (condition.value?.kind !== "text") return true;
  const have = typeof raw === "string" ? raw.toLowerCase() : "";
  const wanted = condition.value.text.trim().toLowerCase();
  switch (condition.operator) {
    case Op.CONTAINS:
      return have.includes(wanted);
    case Op.NOT_CONTAINS:
      return !have.includes(wanted);
    case Op.IS:
      return have.trim() === wanted;
    case Op.IS_NOT:
      return have.trim() !== wanted;
    default:
      return true;
  }
}

function matchNumber(raw: Value, condition: ViewFilterCondition): boolean {
  const have = raw === null || raw === "" ? NaN : Number(raw);
  const value = condition.value;
  if (condition.operator === Op.IS_NOT) {
    return value?.kind !== "number" || Number.isNaN(have) || have !== value.number;
  }
  if (Number.isNaN(have)) return false;
  switch (condition.operator) {
    case Op.IS:
      return value?.kind === "number" && have === value.number;
    case Op.GREATER_THAN:
      return value?.kind === "number" && have > value.number;
    case Op.LESS_THAN:
      return value?.kind === "number" && have < value.number;
    case Op.BETWEEN:
      return value?.kind === "numberRange" && have >= value.min && have <= value.max;
    default:
      return true;
  }
}

function matchDate(raw: Value, condition: ViewFilterCondition, ctx: FilterContext): boolean {
  if (typeof raw !== "string" || !raw) return false;
  const have = calendarDayKey(raw);
  const value = condition.value;
  if (condition.operator === Op.BETWEEN) {
    if (value?.kind !== "dateRange") return true;
    return have >= resolveFilterDate(value.start, ctx) && have <= resolveFilterDate(value.end, ctx);
  }
  if (value?.kind !== "date") return true;
  const wanted = resolveFilterDate(value.date, ctx);
  switch (condition.operator) {
    case Op.IS:
      return have === wanted;
    case Op.BEFORE:
      return have < wanted;
    case Op.AFTER:
      return have > wanted;
    case Op.ON_OR_BEFORE:
      return have <= wanted;
    case Op.ON_OR_AFTER:
      return have >= wanted;
    default:
      return true;
  }
}

/**
 * Negative operators (is not, is none of, does not contain) match a task with no value, the way
 * a person reads "not X". A condition on a field the project no longer has matches nothing.
 */
function evaluateCondition(
  task: Task,
  condition: ViewFilterCondition,
  ctx: FilterContext,
): boolean {
  const kind: FieldKind | null = fieldKindOf(condition.field, ctx.fieldsById);
  if (kind === null) return false;
  const raw = taskRefValue(task, condition.field, ctx);

  if (condition.operator === Op.IS_EMPTY) return isEmptyValue(raw);
  if (condition.operator === Op.IS_NOT_EMPTY) return !isEmptyValue(raw);

  switch (kind) {
    case "boolean":
      return condition.value?.kind === "flag" ? Boolean(raw) === condition.value.flag : true;
    case "text":
      return matchText(raw, condition);
    case "number":
      return matchNumber(raw, condition);
    case "date":
    case "timestamp":
      return matchDate(raw, condition, ctx);
    case "reference":
      return true;
    default:
      return matchIds(toIdList(raw), condition, ctx);
  }
}

function evaluateGroup(task: Task, group: ViewFilterGroup, ctx: FilterContext): boolean {
  if (group.nodes.length === 0) return true;
  const matches = (node: ViewFilterGroup["nodes"][number]) =>
    node.kind === "group"
      ? evaluateGroup(task, node.group, ctx)
      : evaluateCondition(task, node.condition, ctx);
  return group.logic === FilterLogic.OR ? group.nodes.some(matches) : group.nodes.every(matches);
}

export function applyFilters(
  tasks: Task[],
  filter: ViewFilterGroup | null,
  ctx: FilterContext,
): Task[] {
  if (!filter || filter.nodes.length === 0) return tasks;
  return tasks.filter((task) => evaluateGroup(task, filter, ctx));
}
