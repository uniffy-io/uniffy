import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import { searchApi } from "@features/search/searchApi";
import { resolveTaskLabels, type TaskLabel } from "@features/projects/taskLabels";

export { taskUrn, type TaskLabel } from "@features/projects/taskLabels";

const EMPTY: Record<string, TaskLabel> = {};
const LABEL_STALE_MS = 5 * 60_000;

/** Titles through the mention resolver, so a task the person cannot open stays unnamed. */
export function useTaskLabels(taskIds: readonly string[]): Record<string, TaskLabel> {
  const { organizationId } = useAuth();
  const ids = [...new Set(taskIds)].sort();
  const query = useQuery({
    queryKey: ["task-labels", organizationId, ids.join(",")],
    queryFn: ({ signal }) => resolveTaskLabels(organizationId!, ids, searchApi.resolveUrns, signal),
    enabled: !!organizationId && ids.length > 0,
    staleTime: LABEL_STALE_MS,
  });
  return query.data ?? EMPTY;
}
