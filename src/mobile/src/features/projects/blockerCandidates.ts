import type { SerializedTask } from "@features/projects/projectsSerializer";

export type BlockerSectionKey = "siblings" | "epic" | "recent" | "other";

export interface BlockerSection {
  key: BlockerSectionKey;
  label: string;
  tasks: SerializedTask[];
}

const SECTION_LABELS: Record<BlockerSectionKey, string> = {
  siblings: "Same parent",
  epic: "Same epic",
  recent: "Recently updated",
  other: "Other tasks",
};

const RECENT_LIMIT = 5;
const MAX_ANCESTRY = 64;

/** Itself when it is an epic, then every epic above it. */
function epicIdsOf(task: SerializedTask, byId: ReadonlyMap<string, SerializedTask>): string[] {
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

function openFirst(a: SerializedTask, b: SerializedTask): number {
  return Number(!!a.completedAt) - Number(!!b.completedAt);
}

function byBoardOrder(a: SerializedTask, b: SerializedTask): number {
  return openFirst(a, b) || a.sortOrder - b.sortOrder || a.number - b.number;
}

function byRecency(a: SerializedTask, b: SerializedTask): number {
  return (
    openFirst(a, b) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.number - b.number
  );
}

function matches(task: SerializedTask, needle: string): boolean {
  return !needle || task.title.toLowerCase().includes(needle) || `#${task.number}`.includes(needle);
}

/**
 * Candidates for "blocked by", grouped by how likely they are to be the dependency: tasks under
 * the same parent, then tasks in the same epic, then recently updated work, then the rest. Done
 * tasks sort last inside every group. Mirrors the web picker.
 */
export function rankBlockerCandidates(
  current: SerializedTask,
  tasks: readonly SerializedTask[],
  { query, excludeIds }: { query: string; excludeIds: Iterable<string> },
): BlockerSection[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const excluded = new Set([current.id, ...excludeIds]);
  const currentEpics = new Set(epicIdsOf(current, byId));
  const raw = query.trim().toLowerCase();
  const needle = /^\d+$/.test(raw) ? `#${raw}` : raw;

  const siblings: SerializedTask[] = [];
  const epic: SerializedTask[] = [];
  const rest: SerializedTask[] = [];

  for (const task of tasks) {
    if (excluded.has(task.id) || !matches(task, needle)) continue;
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

  const recent = rest.filter((t) => !t.completedAt).slice(0, RECENT_LIMIT);
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
