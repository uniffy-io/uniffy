import { UrnAvailability } from "@uniffy/proto/search/v1/search_pb";
import type { searchApi } from "@features/search/searchApi";

const RESOLVE_BATCH_SIZE = 100;

export interface TaskLabel {
  title: string;
  code: string | null;
}

export function taskUrn(taskId: string): string {
  return `urn:uniffy:content:TASK:${taskId}`;
}

export async function resolveTaskLabels(
  organizationId: string,
  taskIds: readonly string[],
  resolve: typeof searchApi.resolveUrns,
  signal?: AbortSignal,
): Promise<Record<string, TaskLabel>> {
  const ids = [...new Set(taskIds)];
  const labels: Record<string, TaskLabel> = {};
  for (let offset = 0; offset < ids.length; offset += RESOLVE_BATCH_SIZE) {
    signal?.throwIfAborted();
    const batch = ids.slice(offset, offset + RESOLVE_BATCH_SIZE);
    const response = await resolve({ organizationId, urns: batch.map(taskUrn) }, { signal });
    for (const id of batch) {
      const meta = response.resolved[taskUrn(id)];
      if (meta?.availability !== UrnAvailability.AVAILABLE) continue;
      const code =
        meta.projectSlug && meta.taskNumber
          ? `${meta.projectSlug.toUpperCase()}-${meta.taskNumber}`
          : null;
      labels[id] = { title: meta.title, code };
    }
  }
  return labels;
}
