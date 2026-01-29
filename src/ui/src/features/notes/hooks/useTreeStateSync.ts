/**
 * Tree State Sync Hook
 *
 * Syncs the expanded/collapsed state of the notes sidebar tree
 * with localStorage for persistence across navigations.
 */

import { useEffect, useRef } from 'react';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { loadExpandedNodes, saveExpandedNodes } from '../utils/treeStateStorage';

// Action to set expanded nodes without triggering a save loop
const SET_EXPANDED_NODES_FROM_STORAGE = 'notesTree/setExpandedNodesFromStorage';

/**
 * Hook to sync tree expanded state with localStorage.
 * Should be called once in the NotesSidebar component.
 */
export function useTreeStateSync() {
    const dispatch = useAppDispatch();
    const expandedNodes = useAppSelector((state) => state.notesTree.expandedNodes);
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
    const userId = useAppSelector((state) => state.auth.user?.id);

    // Track if we've loaded from storage to avoid overwriting on first render
    const hasLoadedRef = useRef(false);
    const lastSavedRef = useRef<string>('');

    // Load expanded state from localStorage on mount
    useEffect(() => {
        if (!organizationId || !userId || hasLoadedRef.current) {
            return;
        }

        const savedNodes = loadExpandedNodes(organizationId, userId);
        if (savedNodes && savedNodes.length > 0) {
            // Dispatch action to restore expanded state
            dispatch({
                type: SET_EXPANDED_NODES_FROM_STORAGE,
                payload: savedNodes,
            });
        }

        hasLoadedRef.current = true;
    }, [dispatch, organizationId, userId]);

    // Save expanded state to localStorage when it changes
    useEffect(() => {
        if (!organizationId || !userId || !hasLoadedRef.current) {
            return;
        }

        // Create a hash to detect actual changes
        const hash = expandedNodes.join(',');
        if (hash === lastSavedRef.current) {
            return;
        }

        lastSavedRef.current = hash;

        // Debounce the save to avoid too many writes
        const timeoutId = setTimeout(() => {
            saveExpandedNodes(organizationId, userId, expandedNodes);
        }, 300);

        return () => clearTimeout(timeoutId);
    }, [expandedNodes, organizationId, userId]);
}

/**
 * Get the action type for setting expanded nodes from storage.
 * Used in the slice's extraReducers.
 */
export const TREE_STATE_ACTIONS = {
    SET_EXPANDED_NODES_FROM_STORAGE,
};
