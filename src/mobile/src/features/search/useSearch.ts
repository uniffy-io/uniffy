import { useState, useCallback, useRef, useEffect } from "react";
import { useAuth } from "@core/providers/auth-context";
import { searchApi } from "@features/search/searchApi";
import { SearchResultType } from "@uniffy/proto/search/v1/search_pb";
import { searchResultToPlain, domainToTypeFilters } from "@features/search/searchSerializer";
import type { SerializedSearchResult } from "@features/search/searchSerializer";
import type { Domain } from "@core/types";

const DEBOUNCE_MS = 200;

type ActiveFilter = "all" | Domain;

export function useSearch() {
  const { organizationId } = useAuth();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SerializedSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const performSearch = useCallback(
    async (searchQuery: string, filter: ActiveFilter) => {
      if (!searchQuery.trim() || !organizationId) {
        setResults([]);
        setIsLoading(false);
        return;
      }

      if (abortRef.current) {
        abortRef.current.abort();
      }
      abortRef.current = new AbortController();

      setIsLoading(true);
      setError(null);

      try {
        const typeFilters: SearchResultType[] = filter === "all" ? [] : domainToTypeFilters(filter);

        const response = await searchApi.search({
          organizationId,
          query: searchQuery,
          typeFilters,
          limit: 30,
        });

        const serialized = response.items.map(searchResultToPlain).filter((r) => r.domain !== null);

        setResults(serialized);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Search failed");
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    },
    [organizationId],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    debounceRef.current = setTimeout(() => {
      performSearch(query, activeFilter);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, activeFilter, performSearch]);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const clearResults = useCallback(() => {
    setQuery("");
    setResults([]);
    setError(null);
    setActiveFilter("all");
  }, []);

  return {
    query,
    setQuery,
    results,
    isLoading,
    error,
    activeFilter,
    setActiveFilter,
    clearResults,
  };
}
