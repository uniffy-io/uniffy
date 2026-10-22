import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import { searchApi } from "@features/search/searchApi";

export interface TaskLabel {
  title: string;
  /** "REL-12" when the resolver names the project. */
  code: string | null;
}

const EMPTY: Record<string, TaskLabel> = {};
const LABEL_STALE_MS = 5 * 60_000;

export function taskUrn(taskId: string): string {
  return `urn:uniffy:content:TASK:${taskId}`;
}

/** Titles through the mention resolver, so a task the person cannot open stays unnamed. */
export function useTaskLabels(taskIds: readonly string[]): Record<string, TaskLabel> {
  const { organizationId } = useAuth();
  const ids = [...new Set(taskIds)].sort();
  const query = useQuery({
    queryKey: ["task-labels", organizationId, ids.join(",")],
    queryFn: async () => {
      const response = await searchApi.resolveUrns({
        organizationId: organizationId!,
        urns: ids.map(taskUrn),
      });
      const labels: Record<string, TaskLabel> = {};
      for (const id of ids) {
        const meta = response.resolved[taskUrn(id)];
        if (!meta) continue;
        const code =
          meta.projectSlug && meta.taskNumber
            ? `${meta.projectSlug.toUpperCase()}-${meta.taskNumber}`
            : null;
        labels[id] = { title: meta.title, code };
      }
      return labels;
    },
    enabled: !!organizationId && ids.length > 0,
    staleTime: LABEL_STALE_MS,
    placeholderData: keepPreviousData,
  });
  return query.data ?? EMPTY;
}
