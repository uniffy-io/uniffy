import { useCallback, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
    fetchBookmarks,
    toggleBookmark,
    bulkCheckBookmarks,
    clearBookmarks,
    type SerializedBookmark,
} from '@/features/bookmarks/store/bookmarksSlice';

/**
 * Hook for accessing full bookmarks state and actions.
 *
 * Use this when you need to:
 * - List all bookmarks
 * - Access multiple bookmark states
 * - Perform bulk operations
 */
export function useBookmarks() {
    const dispatch = useAppDispatch();
    const {
        bookmarkedUrns,
        bookmarks,
        loading,
        error,
        totalCount,
    } = useAppSelector((state) => state.bookmarks);

    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

    // Fetch bookmarks when organization changes
    useEffect(() => {
        if (!organizationId) return;

        const promise = dispatch(fetchBookmarks());

        // Abort the thunk if component unmounts before it completes
        return () => {
            promise.abort?.();
        };
    }, [dispatch, organizationId]);

    const handleToggle = useCallback(
        (urn: string) => dispatch(toggleBookmark(urn)),
        [dispatch]
    );

    const handleBulkCheck = useCallback(
        (urns: string[]) => dispatch(bulkCheckBookmarks(urns)),
        [dispatch]
    );

    const handleClear = useCallback(
        () => dispatch(clearBookmarks()),
        [dispatch]
    );

    const handleRefresh = useCallback(
        () => dispatch(fetchBookmarks()),
        [dispatch]
    );

    // Get bookmarks as an array sorted by creation date (newest first)
    const bookmarksList = (Object.values(bookmarks) as SerializedBookmark[]).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return {
        // State
        bookmarkedUrns,
        bookmarks: bookmarksList,
        loading,
        error,
        totalCount,

        // Actions
        toggle: handleToggle,
        bulkCheck: handleBulkCheck,
        clear: handleClear,
        refresh: handleRefresh,

        // Helpers
        isBookmarked: (urn: string) => bookmarkedUrns[urn] ?? false,
    };
}

/**
 * Hook to check if a single URN is bookmarked.
 *
 * Use this when you only need to know the bookmark status of one item.
 *
 * @param urn - The URN to check
 * @returns true if the URN is bookmarked, false otherwise
 */
export function useIsBookmarked(urn: string): boolean {
    return useAppSelector((state) => state.bookmarks.bookmarkedUrns[urn] ?? false);
}

/**
 * Hook for toggling a bookmark with loading state.
 *
 * Use this when you need a toggle button with:
 * - Current bookmark status
 * - Loading indicator during toggle
 * - Toggle action
 *
 * @param urn - The URN to manage
 * @returns Object with isBookmarked, toggling, and toggle function
 */
export function useBookmarkToggle(urn: string) {
    const dispatch = useAppDispatch();
    const isBookmarked = useIsBookmarked(urn);
    const toggling = useAppSelector((state) => state.bookmarks.toggling[urn] ?? false);

    const toggle = useCallback(() => {
        dispatch(toggleBookmark(urn));
    }, [dispatch, urn]);

    return {
        isBookmarked,
        toggling,
        toggle,
    };
}

/**
 * Hook to get bookmarks filtered by URN type.
 *
 * @param type - The URN type to filter by (e.g., 'NOTE', 'FILE')
 * @returns Array of bookmarks matching the type
 */
export function useBookmarksByType(type: string): SerializedBookmark[] {
    const bookmarks = useAppSelector((state) => state.bookmarks.bookmarks);
    const typePattern = `urn:uniffy:content:${type.toUpperCase()}:`;

    return Object.values(bookmarks)
        .filter((b) => b.urn.startsWith(typePattern))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
