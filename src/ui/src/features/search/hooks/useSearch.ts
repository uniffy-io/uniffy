/**
 * Search hooks for unified search functionality.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useAppSelector } from '@/app/hooks';
import { searchApi } from '../api/searchApi';
import type { SearchResultItem, SearchResultType } from '@/gen/search/v1/search_pb';

const DEBOUNCE_DELAY_MS = 150;

interface UseSearchResult {
    query: string;
    setQuery: (query: string) => void;
    results: SearchResultItem[];
    isLoading: boolean;
    error: string | null;
    clearResults: () => void;
}

/**
 * Hook for performing debounced global search.
 */
export function useSearch(typeFilters?: SearchResultType[]): UseSearchResult {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResultItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    const performSearch = useCallback(async (searchQuery: string) => {
        if (!searchQuery.trim() || !organizationId) {
            setResults([]);
            setIsLoading(false);
            return;
        }

        // Cancel any in-flight request
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();

        setIsLoading(true);
        setError(null);

        try {
            const response = await searchApi.search({
                organizationId,
                query: searchQuery,
                typeFilters: typeFilters || [],
                limit: 20,
            });

            setResults(response.items);
        } catch (err) {
            // Ignore abort errors
            if (err instanceof Error && err.name === 'AbortError') {
                return;
            }
            setError(err instanceof Error ? err.message : 'Search failed');
            setResults([]);
        } finally {
            setIsLoading(false);
        }
    }, [organizationId, typeFilters]);

    // Debounced search
    useEffect(() => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }

        if (!query.trim()) {
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
    };
}
