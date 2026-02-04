/**
 * Bookmarks feature public exports.
 *
 * This module provides user-scoped bookmarks for any URN-identified content.
 */

export { bookmarksApi } from '@/features/bookmarks/api/bookmarksApi';

export {
    default as bookmarksReducer,
    clearBookmarks,
    setBookmarkStatus,
    clearError,
    fetchBookmarks,
    toggleBookmark,
    bulkCheckBookmarks,
} from '@/features/bookmarks/store/bookmarksSlice';

export type { SerializedBookmark, BookmarksState } from '@/features/bookmarks/store/bookmarksSlice';

export {
    useBookmarks,
    useIsBookmarked,
    useBookmarkToggle,
    useBookmarksByType,
} from '@/features/bookmarks/hooks/useBookmarks';
