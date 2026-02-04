/**
 * Search hooks for unified search functionality.
 *
 * Supports Google-style keyword search filters:
 * - Type filters: note:, file:, user:, calendar:
 * - Tag filters: tag:work
 * - Project filters: project:xyz
 * - Ownership: my: (current user's content)
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useAppSelector } from '@/app/hooks';
import { searchApi } from '@/features/search/api/searchApi';
import type { SearchResultItem, SearchResultType } from '@/gen/search/v1/search_pb';
import {
    parseSearchQuery,
    hasActiveFilters,
    type ParsedQuery,
    type SearchFilters,
} from '@/features/search/utils/queryParser';

const DEBOUNCE_DELAY_MS = 150;

interface UseSearchOptions {
    /** Explicit type filters (merged with parsed filters from query) */
    typeFilters?: SearchResultType[];
    /** Maximum results to return */
    limit?: number;
}

interface UseSearchResult {
    /** Raw query string including filter keywords */
    query: string;
    /** Set the raw query string */
    setQuery: (query: string) => void;
    /** Search results */
    results: SearchResultItem[];
    /** Loading state */
    isLoading: boolean;
    /** Error message if search failed */
    error: string | null;
    /** Clear all results and query */
    clearResults: () => void;
    /** Parsed query with extracted filters */
    parsedQuery: ParsedQuery;
    /** Whether any filters are active */
    hasFilters: boolean;
}

/**
 * Hook for performing debounced global search with keyword filter support.
 *
 * Parses the query string to extract filter keywords like:
 * - `note: meeting` - Search notes for "meeting"
 * - `tag:work project` - Filter by tag:work, search for "project"
 * - `my: drafts` - Search only user's own content
 *
 * @param options - Search options including explicit type filters
 * @returns Search state and controls
 */
export function useSearch(options?: UseSearchOptions): UseSearchResult {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResultItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Parse the query to extract filters
    const parsedQuery = useMemo(() => parseSearchQuery(query), [query]);
    const hasFilters = useMemo(() => hasActiveFilters(parsedQuery.filters), [parsedQuery.filters]);

    const performSearch = useCallback(async (rawQuery: string) => {
        const parsed = parseSearchQuery(rawQuery);
        const searchText = parsed.text;
        const filters = parsed.filters;

        // Check if we have search criteria
        const hasSearchCriteria = searchText.trim() || hasActiveFilters(filters);

        if (!hasSearchCriteria || !organizationId) {
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
            // Merge type filters from parsed query and options
            const typeFilters = [...filters.types];
            if (options?.typeFilters) {
                for (const tf of options.typeFilters) {
                    if (!typeFilters.includes(tf)) {
                        typeFilters.push(tf);
                    }
                }
            }

            const response = await searchApi.search({
                organizationId,
                query: searchText, // Send only the text portion, filters are explicit
                typeFilters: typeFilters.length > 0 ? typeFilters : [],
                tagFilters: filters.tags.length > 0 ? filters.tags : [],
                projectFilters: filters.projects.length > 0 ? filters.projects : [],
                myContentOnly: filters.myContentOnly,
                // Note: owner filter would need username lookup to convert to UUID
                limit: options?.limit || 20,
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
    }, [organizationId, options?.typeFilters, options?.limit]);

    // Debounced search
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

// Re-export types and utilities for convenience
export type { ParsedQuery, SearchFilters };
export { parseSearchQuery, hasActiveFilters } from '@/features/search/utils/queryParser';
