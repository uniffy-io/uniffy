/**
 * Bookmarks feature public exports.
 *
 * This module provides user-scoped bookmarks for any URN-identified content.
 */

// API
export { bookmarksApi } from './api/bookmarksApi';

// Store - Slice & Actions
export {
    default as bookmarksReducer,
    clearBookmarks,
    setBookmarkStatus,
    clearError,
    fetchBookmarks,
    toggleBookmark,
    bulkCheckBookmarks,
} from './store/bookmarksSlice';

// Store - Types
export type { SerializedBookmark, BookmarksState } from './store/bookmarksSlice';

// Hooks
export {
    useBookmarks,
    useIsBookmarked,
    useBookmarkToggle,
    useBookmarksByType,
} from './hooks/useBookmarks';
