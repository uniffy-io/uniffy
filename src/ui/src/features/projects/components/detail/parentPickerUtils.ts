import type { Task } from "@/features/projects/types";

/** Returns rootId plus all descendants; used to reject cycle-forming parent picks. */
export function computeDescendantIds(rootId: string, tasks: Task[]): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const t of tasks) {
    if (!t.parentId) continue;
    const arr = childrenByParent.get(t.parentId);
    if (arr) arr.push(t.id);
    else childrenByParent.set(t.parentId, [t.id]);
  }

  const result = new Set<string>([rootId]);
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const children = childrenByParent.get(id);
    if (!children) continue;
    for (const childId of children) {
      if (result.has(childId)) continue;
      result.add(childId);
      queue.push(childId);
    }
  }
  return result;
}

export interface FilterParentCandidatesOptions {
  /** Ids to remove from the result set (self + descendants). */
  excludedIds: Set<string>;
  /** Restrict to a single task type (e.g. ``epic`` / ``story``). */
  typeFilter: string | null;
  /** Search string matched against title, slug-id (``SLUG-N``), or number. */
  query: string;
  /** Project slug used to expose ``SLUG-N`` matches. */
  projectSlug: string;
  /** Cap on returned results. */
  limit?: number;
}

/** Empty queries surface Epics first for the common "park under an Epic" flow. */
export function filterParentCandidates(
  tasks: Task[],
  { excludedIds, typeFilter, query, projectSlug, limit = 50 }: FilterParentCandidatesOptions,
): Task[] {
  const trimmed = query.trim().toLowerCase();
  const slugLower = projectSlug.toLowerCase();

  const candidates = tasks.filter((t) => {
    if (excludedIds.has(t.id)) return false;
    if (typeFilter && t.taskType !== typeFilter) return false;
    return true;
  });

  if (!trimmed) {
    return [...candidates]
      .sort((a, b) => {
        const aEpic = a.taskType === "epic" ? 0 : 1;
        const bEpic = b.taskType === "epic" ? 0 : 1;
        if (aEpic !== bEpic) return aEpic - bEpic;
        return a.number - b.number;
      })
      .slice(0, limit);
  }

  return candidates
    .filter((t) => {
      if (t.title.toLowerCase().includes(trimmed)) return true;
      if (t.number.toString().includes(trimmed)) return true;
      const ticket = `${slugLower}-${t.number}`;
      return ticket.includes(trimmed);
    })
    .slice(0, limit);
}
