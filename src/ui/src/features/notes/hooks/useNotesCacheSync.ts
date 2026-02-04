/**
 * Notes Cache Sync Hook
 *
 * Automatically syncs notes data to IndexedDB cache whenever
 * the Redux state changes. This ensures the cache stays fresh
 * after create/update/delete operations.
 */

import { useEffect, useRef } from 'react';
import { useAppSelector } from '@/app/hooks';
import { setCachedNotes, isIndexedDBAvailable } from '@/features/notes/utils/notesCache';

/**
 * Hook to automatically sync notes to IndexedDB cache.
 * Should be called once at the notes feature root (e.g., NotesPage).
 */
export function useNotesCacheSync() {
    const notes = useAppSelector((state) => state.notes.notes);
    const tree = useAppSelector((state) => state.notesTree.tree);
    const totalCount = useAppSelector((state) => state.notes.pagination.totalCount);
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
    const userId = useAppSelector((state) => state.auth.user?.id);
    const loading = useAppSelector((state) => state.notes.loading);

    // Track if we've done initial sync to avoid syncing on first render
    const hasInitialized = useRef(false);
    const lastSyncRef = useRef<string>('');

    useEffect(() => {
        // Skip if not ready
        if (!organizationId || !userId || loading) {
            return;
        }

        // Skip if no notes loaded yet
        const notesCount = Object.keys(notes).length;
        if (notesCount === 0) {
            return;
        }

        // Skip if IndexedDB not available
        if (!isIndexedDBAvailable()) {
            return;
        }

        // Create a simple hash of the state to detect changes
        // This prevents unnecessary writes when state hasn't actually changed
        const stateHash = `${notesCount}-${totalCount}-${tree.personal.length}-${tree.organization.length}`;

        // Skip first render (data loaded from cache, no need to write back)
        if (!hasInitialized.current) {
            hasInitialized.current = true;
            lastSyncRef.current = stateHash;
            return;
        }

        // Skip if state hasn't changed
        if (stateHash === lastSyncRef.current) {
            return;
        }

        lastSyncRef.current = stateHash;

        // Debounce the sync to avoid too many writes
        const timeoutId = setTimeout(() => {
            const notesArray = Object.values(notes);
            setCachedNotes(organizationId, userId, notesArray, tree, totalCount).catch((error) => {
                console.error('[NotesCacheSync] Failed to sync cache:', error);
            });
        }, 1000); // 1 second debounce

        return () => clearTimeout(timeoutId);
    }, [notes, tree, totalCount, organizationId, userId, loading]);
}
