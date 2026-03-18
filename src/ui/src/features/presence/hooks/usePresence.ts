import { useEffect } from 'react';
import { useAppSelector } from '@/app/hooks';
import { getStoreRef } from '@/app/storeRef';
import { fetchBulkPresence } from '@/features/presence/store/presenceThunks';
import type { AppDispatch, RootState } from '@/app/store';

/**
 * Module-level batch queue for presence fetching.
 *
 * When usePresence(userId) encounters an unknown user, the ID is added
 * to a pending set. After a short debounce, all pending IDs are flushed
 * in a single bulk API call. This avoids N+1 requests when many mention
 * chips render simultaneously.
 */
const pendingUserIds = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushPendingPresence() {
    flushTimer = null;
    if (pendingUserIds.size === 0) return;

    const store = getStoreRef();
    if (!store) return;

    const state = store.getState() as RootState;
    const organizationId = state.auth.currentOrganizationId;
    if (!organizationId) return;

    // Filter out any that arrived in the store while we were debouncing
    const ids = [...pendingUserIds].filter(
        (id) => !(id in state.presence.statuses),
    );
    pendingUserIds.clear();

    if (ids.length === 0) return;

    (store.dispatch as AppDispatch)(
        fetchBulkPresence({ organizationId, userIds: ids }),
    );
}

function requestPresence(userId: string) {
    pendingUserIds.add(userId);
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushPendingPresence, 150);
}

/**
 * Get the presence status for a single user.
 *
 * Automatically triggers a bulk fetch if the user's presence is not
 * yet in the store. Multiple concurrent calls are batched into a
 * single API request via a 150ms debounce.
 *
 * Returns 'offline' while the fetch is in-flight or if no data exists.
 */
export function usePresence(userId: string): string {
    const status = useAppSelector(
        (state) => state.presence.statuses[userId],
    );

    useEffect(() => {
        if (!userId || status !== undefined) return;
        requestPresence(userId);
    }, [userId, status]);

    return status ?? 'offline';
}
