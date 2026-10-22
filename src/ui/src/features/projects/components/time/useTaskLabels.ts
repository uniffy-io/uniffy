import { useEffect, useMemo, useState } from "react";
import { useAppSelector } from "@/app/hooks";
import { resolveUrnBatched } from "@/components/mention/useBatchedSubjectResolver";
import { taskUrn } from "@/features/projects/utils/timeWeek";

/** Task titles for rows whose task is not in the store, resolved through the mention pipeline. */
export function useTaskLabels(taskIds: readonly string[]): Record<string, string> {
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const tasks = useAppSelector((state) => state.projects.tasks);
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const idsKey = taskIds.join(",");

  useEffect(() => {
    if (!organizationId) return;
    const missing = idsKey.split(",").filter((id) => id && !tasks[id] && !(id in resolved));
    if (missing.length === 0) return;
    let cancelled = false;
    void Promise.all(
      missing.map(async (id) => {
        const preview = await resolveUrnBatched(taskUrn(id), organizationId);
        return [id, preview?.title ?? ""] as const;
      }),
    ).then((pairs) => {
      if (!cancelled) setResolved((previous) => ({ ...previous, ...Object.fromEntries(pairs) }));
    });
    return () => {
      cancelled = true;
    };
  }, [idsKey, organizationId, resolved, tasks]);

  return useMemo(
    () =>
      Object.fromEntries(
        idsKey
          .split(",")
          .filter(Boolean)
          .map((id) => [id, tasks[id]?.title ?? resolved[id] ?? ""]),
      ),
    [idsKey, resolved, tasks],
  );
}
