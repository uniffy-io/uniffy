import { useState, useCallback, useEffect, useRef } from 'react';
import { useAppSelector } from '@/app/hooks';
import { adminApi } from '@/features/admin/api/adminApi';
import { SUBJECT_TYPE, type Subject, type SubjectTypeFilter } from '@/components/subject/types';

interface UseSubjectSearchOptions {
    subjectTypes?: SubjectTypeFilter;
    excludeIds?: string[];
    debounceMs?: number;
    limit?: number;
}

interface UseSubjectSearchResult {
    results: Subject[];
    loading: boolean;
    error: string | null;
    search: (query: string) => void;
    clear: () => void;
}

export function useSubjectSearch(options: UseSubjectSearchOptions = {}): UseSubjectSearchResult {
    const {
        subjectTypes = 'all',
        excludeIds = [],
        debounceMs = 300,
        limit = 20,
    } = options;

    const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<Subject[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const requestIdRef = useRef(0);

    const includeUsers = subjectTypes === 'users' || subjectTypes === 'all';
    const includeGroups = subjectTypes === 'groups' || subjectTypes === 'all';

    useEffect(() => {
        if (timerRef.current) clearTimeout(timerRef.current);

        if (query.trim().length < 2 || !organizationId) {
            setResults([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        const requestId = ++requestIdRef.current;

        timerRef.current = setTimeout(async () => {
            try {
                const promises: Promise<Subject[]>[] = [];
                if (includeUsers) {
                    promises.push(
                        adminApi
                            .listMembers({
                                organizationId,
                                search: query,
                                pagination: { page: 1, pageSize: limit },
                            })
                            .then((res): Subject[] =>
                                res.members.map((m) => ({
                                    id: m.userId,
                                    type: SUBJECT_TYPE.USER,
                                    name: m.displayName,
                                    email: m.email,
                                    avatarUrl: m.avatarUrl || undefined,
                                })),
                            ),
                    );
                }
                if (includeGroups) {
                    promises.push(
                        adminApi
                            .listGroups({
                                organizationId,
                                search: query,
                                pagination: { page: 1, pageSize: limit },
                            })
                            .then((res): Subject[] =>
                                res.groups.map((g) => ({
                                    id: g.id,
                                    type: SUBJECT_TYPE.GROUP,
                                    name: g.name,
                                    memberCount: g.memberCount,
                                })),
                            ),
                    );
                }

                const settled = await Promise.all(promises);
                if (requestId !== requestIdRef.current) return;

                const combined = settled.flat();
                setResults(combined);
                setError(null);
            } catch (err) {
                if (requestId !== requestIdRef.current) return;
                setError(err instanceof Error ? err.message : 'Failed to search');
                setResults([]);
            } finally {
                if (requestId === requestIdRef.current) setLoading(false);
            }
        }, debounceMs);

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [query, organizationId, includeUsers, includeGroups, debounceMs, limit]);

    const excludeSet = new Set(excludeIds);
    const filtered = results.filter((s) => !excludeSet.has(s.id));

    const search = useCallback((q: string) => {
        setQuery(q);
    }, []);

    const clear = useCallback(() => {
        setQuery('');
        setResults([]);
    }, []);

    return { results: filtered, loading, error, search, clear };
}
