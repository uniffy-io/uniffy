import type { Task } from "@/features/projects/types";

/** A search matches the title, the description, `#12`, or the `SLUG-12` key the views show. */
export function taskMatchesSearch(task: Task, query: string, projectSlug?: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    task.title.toLowerCase().includes(needle) ||
    task.description.toLowerCase().includes(needle) ||
    `#${task.number}`.includes(needle) ||
    (!!projectSlug && `${projectSlug}-${task.number}`.toLowerCase().includes(needle))
  );
}
