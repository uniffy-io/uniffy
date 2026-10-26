import { useEffect, useRef, useState } from "react";
import { SearchResultType } from "@uniffy/proto/search/v1/search_pb";
import { useAppSelector } from "@/app/hooks";
import { resolveMentionBatch } from "@/components/mention/resolveMentionBatch";
import { searchApi } from "@/features/search/api/searchApi";
import { parseUrn } from "@/shared/utils/urn";

const DEBOUNCE_MS = 200;
const LIMIT = 15;

export interface TaskHit {
  id: string;
  title: string;
  /** "REL-12" when the index knows the project. */
  code: string | null;
  type: string;
}

/** Tasks the person can open that match what they typed, debounced. */
export function useTaskSearch(query: string): { hits: TaskHit[]; loading: boolean } {
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const [hits, setHits] = useState<TaskHit[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    abortRef.current?.abort();
    if (!trimmed || !organizationId) {
      // eslint-disable-next-line react/react-compiler
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = window.setTimeout(async () => {
      try {
        const response = await searchApi.search(
          {
            organizationId,
            query: trimmed,
            typeFilters: [SearchResultType.TASK],
            limit: LIMIT,
          },
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        // The index holds only the title; the type, number and project come from the
        // same resolve the mention chips use.
        const resolved = await resolveMentionBatch(
          organizationId,
          response.items.map((item) => item.urn),
        );
        if (controller.signal.aborted) return;
        setHits(
          response.items.map((item) => {
            const live = resolved[item.urn]?.metadata ?? {};
            return {
              id: parseUrn(item.urn)?.id ?? item.urn,
              title: item.title,
              code:
                live.project_slug && live.task_number
                  ? `${live.project_slug.toUpperCase()}-${live.task_number}`
                  : null,
              type: live.task_type || "task",
            };
          }),
        );
      } catch {
        if (!controller.signal.aborted) setHits([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, organizationId]);

  return { hits, loading };
}
