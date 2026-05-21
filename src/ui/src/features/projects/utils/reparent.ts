import type { Task } from "@/features/projects/types";
import { computeDescendantIds } from "@/features/projects/components/detail/parentPickerUtils";

export interface ReparentCheck {
  ok: boolean;
  reason?: "self" | "already-parent" | "cycle";
}

export function checkReparent(
  activeId: string,
  targetId: string,
  allTasks: Task[],
  currentParentId: string | null | undefined,
): ReparentCheck {
  if (activeId === targetId) return { ok: false, reason: "self" };
  if (currentParentId === targetId) return { ok: false, reason: "already-parent" };
  const blocked = computeDescendantIds(activeId, allTasks);
  if (blocked.has(targetId)) return { ok: false, reason: "cycle" };
  return { ok: true };
}
