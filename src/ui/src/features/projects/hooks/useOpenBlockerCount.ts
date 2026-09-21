import { useAppSelector } from "@/app/hooks";
import type { Task } from "@/features/projects/types/project";
import { openBlockerCount } from "@/features/projects/utils/taskRelations";

/** Returns a number, so a row re-renders only when its own count changes. */
export function useOpenBlockerCount(task: Task): number {
  return useAppSelector((state) => openBlockerCount(task, (id) => state.projects.tasks[id]));
}
