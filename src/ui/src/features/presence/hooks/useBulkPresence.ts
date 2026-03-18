import { useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { fetchBulkPresence } from '@/features/presence/store/presenceThunks';

const DEBOUNCE_MS = 200;

/**
 * Fetch presence for a list of user IDs.
 *
 * Debounces requests (200ms) and deduplicates against already-known
 * statuses in the store. Call this in components that render user lists.
 */
export function useBulkPresence(userIds: string[]) {
    const dispatch = useAppDispatch();
    const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);
    const knownStatuses = useAppSelector((s) => s.presence.statuses);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const prevKeyRef = useRef<string>('');

    useEffect(() => {
        if (!organizationId || userIds.length === 0) return;

        // Stabilize reference - only re-run if the sorted list actually changed
        const key = [...userIds].sort().join(',');
        if (key === prevKeyRef.current) return;
        prevKeyRef.current = key;

        // Filter out already-known users
        const unknown = userIds.filter((id) => !(id in knownStatuses));
        if (unknown.length === 0) return;

        // Debounce
        if (timerRef.current) {
            clearTimeout(timerRef.current);
        }

        timerRef.current = setTimeout(() => {
            dispatch(
                fetchBulkPresence({
                    organizationId,
                    userIds: unknown,
                }),
            );
        }, DEBOUNCE_MS);

        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
            }
        };
    }, [dispatch, organizationId, userIds, knownStatuses]);
}
