import { useEffect, useRef } from 'react';
import { useAppSelector } from '@/app/hooks';
import { setCachedNotes, isIndexedDBAvailable } from '@/features/notes/utils/notesCache';

export function useNotesCacheSync() {
    const notes = useAppSelector((state) => state.notes.notes);
    const tree = useAppSelector((state) => state.notesTree.tree);
    const totalCount = useAppSelector((state) => state.notes.pagination.totalCount);
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
    const userId = useAppSelector((state) => state.auth.user?.id);
    const loading = useAppSelector((state) => state.notes.loading);

    const hasInitialized = useRef(false);
    const lastSyncRef = useRef<string>('');

    useEffect(() => {
        if (!organizationId || !userId || loading) {
            return;
        }

        const notesCount = Object.keys(notes).length;
        if (notesCount === 0) {
            return;
        }

        if (!isIndexedDBAvailable()) {
            return;
        }

        const stateHash = `${notesCount}-${totalCount}-${tree.personal.length}-${tree.organization.length}`;

        // Skip first render - data was loaded from cache.
        if (!hasInitialized.current) {
            hasInitialized.current = true;
            lastSyncRef.current = stateHash;
            return;
        }

        if (stateHash === lastSyncRef.current) {
            return;
        }

        lastSyncRef.current = stateHash;

        const timeoutId = setTimeout(() => {
            const notesArray = Object.values(notes);
            setCachedNotes(organizationId, userId, notesArray, tree, totalCount).catch((error) => {
                console.error('[NotesCacheSync] Failed to sync cache:', error);
            });
        }, 1000);

        return () => clearTimeout(timeoutId);
    }, [notes, tree, totalCount, organizationId, userId, loading]);
}
