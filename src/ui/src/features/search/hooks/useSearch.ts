import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useAppSelector } from '@/app/hooks';
import { searchApi } from '@/features/search/api/searchApi';
import { isCanceledError } from '@/shared/utils/rpcErrors';
import type { SearchResultItem, SearchResultType } from '@uniffy/proto/search/v1/search_pb';
import {
    parseSearchQuery,
    hasActiveFilters,
    type ParsedQuery,
    type SearchFilters,
} from '@/features/search/utils/queryParser';
const DEBOUNCE_DELAY_MS = 150;

interface UseSearchOptions {
    typeFilters?: SearchResultType[];
    /** Ranking context sent to the backend: listed types float to the top in this order. */
    typePriority?: SearchResultType[];
    /** Match titles/names only (mention pickers); skips content, description, tags. */
    nameMatchesOnly?: boolean;
    limit?: number;
}

interface UseSearchResult {
    query: string;
    setQuery: (query: string) => void;
    results: SearchResultItem[];
    /** Meilisearch estimate of all matches before pagination (0 while empty). */
    totalCount: number;
    isLoading: boolean;
    error: string | null;
    clearResults: () => void;
    parsedQuery: ParsedQuery;
    hasFilters: boolean;
}

export function useSearch(options?: UseSearchOptions): UseSearchResult {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResultItem[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    const parsedQuery = useMemo(() => parseSearchQuery(query), [query]);
    const hasFilters = useMemo(() => hasActiveFilters(parsedQuery.filters), [parsedQuery.filters]);

    const performSearch = useCallback(async (rawQuery: string) => {
        const parsed = parseSearchQuery(rawQuery);
        const searchText = parsed.text;
        const filters = parsed.filters;

        const hasSearchCriteria = searchText.trim() || hasActiveFilters(filters);

        if (!hasSearchCriteria || !organizationId) {
            setResults([]);
            setTotalCount(0);
            setIsLoading(false);
            return;
        }

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        const controller = new AbortController();
        abortControllerRef.current = controller;

        setIsLoading(true);
        setError(null);

        try {
            const typeFilters = [...filters.types];
            if (options?.typeFilters) {
                for (const tf of options.typeFilters) {
                    if (!typeFilters.includes(tf)) {
                        typeFilters.push(tf);
                    }
                }
            }

            const response = await searchApi.search(
                {
                    organizationId,
                    query: searchText,
                    typeFilters: typeFilters.length > 0 ? typeFilters : [],
                    tagFilters: filters.tags.length > 0 ? filters.tags : [],
                    projectFilters: filters.projects.length > 0 ? filters.projects : [],
                    myContentOnly: filters.myContentOnly,
                    typePriority: options?.typePriority ?? [],
                    nameMatchesOnly: options?.nameMatchesOnly ?? false,
                    limit: options?.limit || 20,
                },
                { signal: controller.signal },
            );

            setResults(response.items);
            setTotalCount(response.totalCount);
        } catch (err) {
            if (isCanceledError(err)) {
                return;
            }
            setError(err instanceof Error ? err.message : 'Search failed');
            setResults([]);
            setTotalCount(0);
        } finally {
            // A superseded request must not clear the spinner for the one that replaced it.
            if (abortControllerRef.current === controller) {
                setIsLoading(false);
            }
        }
    }, [organizationId, options?.typeFilters, options?.typePriority, options?.nameMatchesOnly, options?.limit]);

    useEffect(() => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }

        const parsed = parseSearchQuery(query);
        const hasSearchCriteria = parsed.text.trim() || hasActiveFilters(parsed.filters);

        if (!hasSearchCriteria) {
            setResults([]);
            setTotalCount(0);
            setIsLoading(false);
            return;
        }

        setIsLoading(true);

        debounceRef.current = setTimeout(() => {
            performSearch(query);
        }, DEBOUNCE_DELAY_MS);

        return () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
        };
    }, [query, performSearch]);

    const clearResults = useCallback(() => {
        setQuery('');
        setResults([]);
        setTotalCount(0);
        setError(null);
    }, []);

    return {
        query,
        setQuery,
        results,
        totalCount,
        isLoading,
        error,
        clearResults,
        parsedQuery,
        hasFilters,
    };
}

export type { ParsedQuery, SearchFilters };
export { parseSearchQuery, hasActiveFilters } from '@/features/search/utils/queryParser';
