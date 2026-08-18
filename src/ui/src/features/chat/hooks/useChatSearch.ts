import { useState, useEffect, useRef, useCallback } from "react";
import { searchApi } from "@/features/search/api/searchApi";
import { SearchResultType } from "@uniffy/proto/search/v1/search_pb";
import { useAppSelector } from "@/app/hooks";
import type { SearchResultItem } from "@uniffy/proto/search/v1/search_pb";

interface ChatSearchFilters {
  channelId?: string;
  senderId?: string;
}

interface UseChatSearchResult {
  results: SearchResultItem[];
  isLoading: boolean;
  error: string | null;
  resultCount: number;
  hasMore: boolean;
  search: (query: string, filters?: ChatSearchFilters) => void;
  clear: () => void;
}

const DEBOUNCE_MS = 200;

export function useChatSearch(): UseChatSearchResult {
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);

  const search = useCallback(
    (query: string, filters?: ChatSearchFilters) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();

      if (!query.trim() && !filters?.channelId && !filters?.senderId) {
        setResults([]);
        setHasMore(false);
        setError(null);
        return;
      }

      setIsLoading(true);
      setError(null);

      timerRef.current = window.setTimeout(async () => {
        if (!organizationId) return;

        const controller = new AbortController();
        abortRef.current = controller;

        try {
          const metadataFilters: Record<string, string> = {};
          if (filters?.channelId) metadataFilters.channel_id = filters.channelId;
          if (filters?.senderId) metadataFilters.sender_id = filters.senderId;

          const response = await searchApi.search(
            {
              organizationId,
              query: query.trim(),
              typeFilters: [SearchResultType.CHAT_MESSAGE],
              metadataFilters:
                Object.keys(metadataFilters).length > 0 ? metadataFilters : undefined,
              limit: 50,
            },
            { signal: controller.signal },
          );

          if (!controller.signal.aborted) {
            setResults([...response.items]);
            setHasMore(response.hasMore);
            setIsLoading(false);
          }
        } catch (err) {
          if (!controller.signal.aborted) {
            setError(err instanceof Error ? err.message : "Search failed");
            setIsLoading(false);
          }
        }
      }, DEBOUNCE_MS);
    },
    [organizationId],
  );

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();
    setResults([]);
    setHasMore(false);
    setError(null);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return {
    results,
    isLoading,
    error,
    resultCount: results.length,
    hasMore,
    search,
    clear,
  };
}
