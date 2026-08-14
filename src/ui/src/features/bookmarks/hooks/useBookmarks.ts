import { useCallback, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  fetchBookmarks,
  toggleBookmark,
  bulkCheckBookmarks,
  clearBookmarks,
  type SerializedBookmark,
} from "@/features/bookmarks/store/bookmarksSlice";

export function useBookmarks() {
  const dispatch = useAppDispatch();
  const { bookmarkedUrns, bookmarks, loading, error, totalCount } = useAppSelector(
    (state) => state.bookmarks,
  );

  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

  useEffect(() => {
    if (!organizationId) return;

    const promise = dispatch(fetchBookmarks());

    return () => {
      promise.abort?.();
    };
  }, [dispatch, organizationId]);

  const handleToggle = useCallback((urn: string) => dispatch(toggleBookmark(urn)), [dispatch]);

  const handleBulkCheck = useCallback(
    (urns: string[]) => dispatch(bulkCheckBookmarks(urns)),
    [dispatch],
  );

  const handleClear = useCallback(() => dispatch(clearBookmarks()), [dispatch]);

  const handleRefresh = useCallback(() => dispatch(fetchBookmarks()), [dispatch]);

  const bookmarksList = (Object.values(bookmarks) as SerializedBookmark[]).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return {
    bookmarkedUrns,
    bookmarks: bookmarksList,
    loading,
    error,
    totalCount,

    toggle: handleToggle,
    bulkCheck: handleBulkCheck,
    clear: handleClear,
    refresh: handleRefresh,

    isBookmarked: (urn: string) => bookmarkedUrns[urn] ?? false,
  };
}

export function useIsBookmarked(urn: string): boolean {
  return useAppSelector((state) => state.bookmarks.bookmarkedUrns[urn] ?? false);
}

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

export function useBookmarksByType(type: string): SerializedBookmark[] {
  const bookmarks = useAppSelector((state) => state.bookmarks.bookmarks);
  const typePattern = `urn:uniffy:content:${type.toUpperCase()}:`;

  return Object.values(bookmarks)
    .filter((b) => b.urn.startsWith(typePattern))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
