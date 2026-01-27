/**
 * Bookmarks feature public exports.
 *
 * This module provides user-scoped bookmarks for any URN-identified content.
 */

export { bookmarksApi } from './api/bookmarksApi';

export {
    default as bookmarksReducer,
    clearBookmarks,
    setBookmarkStatus,
    clearError,
    fetchBookmarks,
    toggleBookmark,
    bulkCheckBookmarks,
} from './store/bookmarksSlice';

export type { SerializedBookmark, BookmarksState } from './store/bookmarksSlice';

export {
    useBookmarks,
    useIsBookmarked,
    useBookmarkToggle,
    useBookmarksByType,
} from './hooks/useBookmarks';
