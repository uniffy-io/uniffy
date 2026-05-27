import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useAppSelector } from '@/app/hooks';
import { searchApi } from '@/features/search/api/searchApi';
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
    /** Ignored when explicit typeFilters are set. */
    excludeTypes?: SearchResultType[];
    limit?: number;
}

interface UseSearchResult {
    query: string;
    setQuery: (query: string) => void;
    results: SearchResultItem[];
    isLoading: boolean;
    error: string | null;
    clearResults: () => void;
    parsedQuery: ParsedQuery;
    hasFilters: boolean;
}

export function useSearch(options?: UseSearchOptions): UseSearchResult {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResultItem[]>([]);
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
            setIsLoading(false);
            return;
        }

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();

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

            // excludeTypes only applies when no explicit type filter is set
            const excludeTypes = (typeFilters.length === 0 && options?.excludeTypes)
                ? options.excludeTypes
                : [];

            const response = await searchApi.search({
                organizationId,
                query: searchText,
                typeFilters: typeFilters.length > 0 ? typeFilters : [],
                excludeTypes: excludeTypes.length > 0 ? excludeTypes : [],
                tagFilters: filters.tags.length > 0 ? filters.tags : [],
                projectFilters: filters.projects.length > 0 ? filters.projects : [],
                myContentOnly: filters.myContentOnly,
                limit: options?.limit || 20,
            });

            setResults(response.items);
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                return;
            }
            setError(err instanceof Error ? err.message : 'Search failed');
            setResults([]);
        } finally {
            setIsLoading(false);
        }
    }, [organizationId, options?.typeFilters, options?.excludeTypes, options?.limit]);

    useEffect(() => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }

        const parsed = parseSearchQuery(query);
        const hasSearchCriteria = parsed.text.trim() || hasActiveFilters(parsed.filters);

        if (!hasSearchCriteria) {
            setResults([]);
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
        setError(null);
    }, []);

    return {
        query,
        setQuery,
        results,
        isLoading,
        error,
        clearResults,
        parsedQuery,
        hasFilters,
    };
}

export type { ParsedQuery, SearchFilters };
export { parseSearchQuery, hasActiveFilters } from '@/features/search/utils/queryParser';
