import { useEffect, useRef, useState } from "react";
import { SearchResultType } from "@uniffy/proto/search/v1/search_pb";
import { useAppSelector } from "@/app/hooks";
import { searchApi } from "@/features/search/api/searchApi";
import { parseUrn } from "@/shared/utils/urn";

const DEBOUNCE_MS = 200;
const LIMIT = 30;

export interface ProjectHit {
  id: string;
  name: string;
}

/** Projects the viewer can open that match what they typed, debounced. */
export function useProjectSearch(query: string): ProjectHit[] {
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const [hits, setHits] = useState<ProjectHit[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    abortRef.current?.abort();
    if (!trimmed || !organizationId) {
      // eslint-disable-next-line react/react-compiler
      setHits([]);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = window.setTimeout(async () => {
      try {
        const response = await searchApi.search(
          {
            organizationId,
            query: trimmed,
            typeFilters: [SearchResultType.PROJECT],
            limit: LIMIT,
          },
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setHits(
          response.items.flatMap((item) => {
            const id = parseUrn(item.urn)?.id;
            return id ? [{ id, name: item.title }] : [];
          }),
        );
      } catch {
        if (!controller.signal.aborted) setHits([]);
      }
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, organizationId]);

  return hits;
}
