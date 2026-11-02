import type { Task } from "@/features/projects/types/project";
import { taskMatchesSearch } from "@/features/projects/utils/taskSearch";

export type BlockerSectionKey = "siblings" | "epic" | "recent" | "other";

export interface BlockerSection {
  key: BlockerSectionKey;
  label: string;
  tasks: Task[];
}

const SECTION_LABELS: Record<BlockerSectionKey, string> = {
  siblings: "Same parent",
  epic: "Same epic",
  recent: "Recently updated",
  other: "Other tasks",
};

const RECENT_LIMIT = 5;
const MAX_ANCESTRY = 64;

interface Options {
  query: string;
  excludeIds: Iterable<string>;
  projectSlug?: string;
}

/** Itself when it is an epic, then every epic above it. */
function epicIdsOf(task: Task, byId: ReadonlyMap<string, Task>): string[] {
  const ids = task.taskType === "epic" ? [task.id] : [];
  const seen = new Set<string>();
  let parentId = task.parentId;
  while (parentId && !seen.has(parentId) && seen.size < MAX_ANCESTRY) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    if (parent.taskType === "epic") ids.push(parent.id);
    parentId = parent.parentId;
  }
  return ids;
}

function openFirst(a: Task, b: Task): number {
  return Number(!!a.completedAt) - Number(!!b.completedAt);
}

function byBoardOrder(a: Task, b: Task): number {
  return openFirst(a, b) || a.sortOrder - b.sortOrder || a.number - b.number;
}

function byRecency(a: Task, b: Task): number {
  return openFirst(a, b) || b.updatedAt.localeCompare(a.updatedAt) || a.number - b.number;
}

/**
 * Candidates for "blocked by", grouped by how likely they are to be the dependency: tasks under
 * the same parent, then tasks in the same epic, then recently updated work, then the rest. Done
 * tasks sort last inside every group.
 */
export function rankBlockerCandidates(
  current: Task,
  tasks: readonly Task[],
  { query, excludeIds, projectSlug }: Options,
): BlockerSection[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const excluded = new Set([current.id, ...excludeIds]);
  const currentEpics = new Set(epicIdsOf(current, byId));

  const siblings: Task[] = [];
  const epic: Task[] = [];
  const rest: Task[] = [];

  for (const task of tasks) {
    if (excluded.has(task.id) || task.deletedAt || task.projectId !== current.projectId) continue;
    if (!taskMatchesSearch(task, query, projectSlug)) continue;
    if (current.parentId && task.parentId === current.parentId) {
      siblings.push(task);
    } else if (
      currentEpics.size > 0 &&
      epicIdsOf(task, byId).some((id) => currentEpics.has(id) && id !== task.id)
    ) {
      epic.push(task);
    } else {
      rest.push(task);
    }
  }

  siblings.sort(byBoardOrder);
  epic.sort(byBoardOrder);
  rest.sort(byRecency);

  const openRest = rest.filter((t) => !t.completedAt);
  const recent = openRest.slice(0, RECENT_LIMIT);
  const recentIds = new Set(recent.map((t) => t.id));
  const other = rest.filter((t) => !recentIds.has(t.id)).sort(byBoardOrder);

  const sections: BlockerSection[] = [
    { key: "siblings", label: SECTION_LABELS.siblings, tasks: siblings },
    { key: "epic", label: SECTION_LABELS.epic, tasks: epic },
    { key: "recent", label: SECTION_LABELS.recent, tasks: recent },
    { key: "other", label: SECTION_LABELS.other, tasks: other },
  ];
  return sections.filter((section) => section.tasks.length > 0);
}

/** The nearest parent's title, so tasks with the same name can be told apart. */
export function parentLabel(task: Task, byId: ReadonlyMap<string, Task>): string | null {
  if (!task.parentId) return null;
  return byId.get(task.parentId)?.title ?? null;
}
