export { bookmarksApi } from "@/features/bookmarks/api/bookmarksApi";

export {
  bookmarksReducer,
  clearBookmarks,
  setBookmarkStatus,
  clearError,
  fetchBookmarkItems,
  toggleBookmark,
  toggleBookmarkSafely,
  addBookmarksSafely,
  bulkCheckBookmarks,
} from "@/features/bookmarks/store/bookmarksSlice";

export type {
  SerializedBookmark,
  SerializedBookmarkItem,
  SerializedBookmarkContent,
  BookmarkItemsScope,
  BookmarksState,
} from "@/features/bookmarks/store/bookmarksSlice";

export {
  useBookmarkItems,
  useIsBookmarked,
  useBookmarkStatuses,
  useBookmarkToggle,
} from "@/features/bookmarks/hooks/useBookmarks";

export {
  BOOKMARK_FILTER_TYPES,
  parseBookmarkTypesParam,
  serializeBookmarkTypesParam,
} from "@/features/bookmarks/utils/bookmarkTypes";
