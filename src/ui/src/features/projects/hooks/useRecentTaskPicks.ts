import { useCallback, useState } from "react";
import { useAppSelector } from "@/app/hooks";
import type { TaskHit } from "@/features/projects/hooks/useTaskSearch";

const LIMIT = 8;

const keyOf = (organizationId: string, userId: string) =>
  `uniffy:time:recent-picks:${organizationId}:${userId}`;

function read(key: string): TaskHit[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? (parsed as TaskHit[]).slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

/**
 * Tasks this person last picked in the Log time dialog, newest first. A per-browser
 * convenience keyed by organization and person, so a shared browser keeps them apart.
 */
export function useRecentTaskPicks(): { recent: TaskHit[]; remember: (task: TaskHit) => void } {
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId ?? "");
  const userId = useAppSelector((state) => state.auth.user?.id ?? "");
  const key = keyOf(organizationId, userId);
  const [recent, setRecent] = useState(() => read(key));

  const remember = useCallback(
    (task: TaskHit) => {
      const next = [task, ...read(key).filter((entry) => entry.id !== task.id)].slice(0, LIMIT);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Storage may be full or blocked; the list is only a convenience.
      }
      setRecent(next);
    },
    [key],
  );

  return { recent, remember };
}
