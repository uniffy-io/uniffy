import { useEffect, useState } from "react";
import { useAppDispatch } from "@/app/hooks";
import { searchProjectTasks } from "@/features/projects/store/projectsThunks";

const DEBOUNCE_MS = 250;

/**
 * Asks the server for tasks matching a picker query and merges them into the store, so a picker
 * that ranks the loaded tasks also sees ones the client never fetched. Returns whether a search is
 * in flight.
 */
export function useServerTaskSearch(projectId: string | undefined, query: string): boolean {
  const dispatch = useAppDispatch();
  const trimmed = query.trim();
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId || !trimmed) return;
    let promise: { abort: () => void } | null = null;
    const timer = window.setTimeout(() => {
      setPendingQuery(trimmed);
      const request = dispatch(searchProjectTasks({ projectId, query: trimmed }));
      promise = request;
      void request.finally(() => {
        setPendingQuery((current) => (current === trimmed ? null : current));
      });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      promise?.abort();
    };
  }, [dispatch, projectId, trimmed]);

  return !!trimmed && pendingQuery === trimmed;
}
