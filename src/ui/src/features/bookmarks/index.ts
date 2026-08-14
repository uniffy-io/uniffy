export { bookmarksApi } from "@/features/bookmarks/api/bookmarksApi";

export {
  bookmarksReducer,
  clearBookmarks,
  setBookmarkStatus,
  clearError,
  fetchBookmarks,
  toggleBookmark,
  bulkCheckBookmarks,
} from "@/features/bookmarks/store/bookmarksSlice";

export type { SerializedBookmark, BookmarksState } from "@/features/bookmarks/store/bookmarksSlice";

export {
  useBookmarks,
  useIsBookmarked,
  useBookmarkToggle,
  useBookmarksByType,
} from "@/features/bookmarks/hooks/useBookmarks";
