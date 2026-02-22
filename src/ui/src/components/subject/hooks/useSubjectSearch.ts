/**
 * useSubjectSearch Hook
 *
 * Debounced search for users and groups, wrapping the existing
 * searchShareTargets thunk from the sharing store.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { searchShareTargets } from '@/features/sharing/store/sharingThunks';
import { clearSearchResults } from '@/features/sharing/store/sharingSlice';
import { shareTargetToSubject } from '@/components/subject/utils';
import type { Subject, SubjectTypeFilter } from '@/components/subject/types';

interface UseSubjectSearchOptions {
    /** Which types to include. Default: 'all'. */
    subjectTypes?: SubjectTypeFilter;
    /** IDs to exclude from results (e.g. already selected). */
    excludeIds?: string[];
    /** Debounce delay in ms. Default: 300. */
    debounceMs?: number;
}

interface UseSubjectSearchResult {
    results: Subject[];
    loading: boolean;
    search: (query: string) => void;
    clear: () => void;
}

export function useSubjectSearch(options: UseSubjectSearchOptions = {}): UseSubjectSearchResult {
    const {
        subjectTypes = 'all',
        excludeIds = [],
        debounceMs = 300,
    } = options;

    const dispatch = useAppDispatch();
    const rawResults = useAppSelector((state) => state.sharing.searchResults);
    const loading = useAppSelector((state) => state.sharing.searchLoading);
    const [query, setQuery] = useState('');
    const timerRef = useRef<ReturnType<typeof setTimeout>>();

    const includeUsers = subjectTypes === 'users' || subjectTypes === 'all';
    const includeGroups = subjectTypes === 'groups' || subjectTypes === 'all';

    // Debounced dispatch
    useEffect(() => {
        if (timerRef.current) clearTimeout(timerRef.current);

        if (query.trim().length < 2) {
            dispatch(clearSearchResults());
            return;
        }

        timerRef.current = setTimeout(() => {
            dispatch(searchShareTargets({ query, includeUsers, includeGroups }));
        }, debounceMs);

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [query, includeUsers, includeGroups, debounceMs, dispatch]);

    // Convert and filter results
    const excludeSet = new Set(excludeIds);
    const results = rawResults
        .filter((t) => !excludeSet.has(t.id))
        .map(shareTargetToSubject);

    const search = useCallback((q: string) => {
        setQuery(q);
    }, []);

    const clear = useCallback(() => {
        setQuery('');
        dispatch(clearSearchResults());
    }, [dispatch]);

    return { results, loading, search, clear };
}
