import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import type { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { useAuth } from "@core/providers/AuthContext";
import { bookmarksApi } from "@features/bookmarks/bookmarksApi";
import {
  bookmarkItemToPlain,
  type SerializedBookmarkItem,
} from "@features/bookmarks/bookmarksSerializer";

/** See the web counterpart: an empty page can still carry a continuation token. */
const BOOKMARK_MAX_PAGES_PER_FETCH = 4;

interface BookmarkItemsPage {
  items: SerializedBookmarkItem[];
  nextPageToken: string | null;
}

export function useBookmarkItems(contentTypes: ContentType[]) {
  const { organizationId, isAuthenticated } = useAuth();

  return useInfiniteQuery({
    queryKey: ["bookmark-items", organizationId, contentTypes],
    enabled: !!organizationId && isAuthenticated,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const items: SerializedBookmarkItem[] = [];
      let pageToken = pageParam;
      let nextPageToken: string | null = null;

      // The server answers with an empty page plus a continuation token when a whole
      // scan window resolves to content the caller can no longer read. A FlatList with
      // empty data never fires onEndReached, so stopping here strands the rest.
      for (let page = 0; page < BOOKMARK_MAX_PAGES_PER_FETCH; page += 1) {
        const response = await bookmarksApi.listBookmarkItems({
          organizationId: organizationId!,
          contentTypes,
          pageSize: 50,
          pageToken,
        });
        items.push(
          ...response.items
            .map(bookmarkItemToPlain)
            .filter((item): item is SerializedBookmarkItem => item !== null),
        );
        nextPageToken = response.nextPageToken ?? null;
        if (!nextPageToken || items.length > 0) break;
        pageToken = nextPageToken;
      }

      return { items, nextPageToken };
    },
    getNextPageParam: (lastPage) => lastPage.nextPageToken ?? undefined,
  });
}

export function useIsBookmarked(urn: string) {
  const { organizationId, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ["bookmark-check", organizationId, urn],
    enabled: !!organizationId && !!urn && isAuthenticated,
    queryFn: async () => {
      const response = await bookmarksApi.bulkCheckBookmarks({
        organizationId: organizationId!,
        urns: [urn],
      });
      return response.bookmarkedUrns[urn] ?? false;
    },
    staleTime: 30_000,
  });
}

export function useToggleBookmark() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (urn: string) =>
      bookmarksApi.toggleBookmark({
        organizationId: organizationId!,
        urn,
      }),
    onSuccess: (response, urn) => {
      // Invalidating the whole list key refetches every loaded infinite-query page,
      // so a single star tap on a deep list costs one request per page. Write the
      // known outcome instead and only refetch the list when an item was added.
      queryClient.setQueryData(["bookmark-check", organizationId, urn], response.isBookmarked);
      // The notes list has a bookmarked-only filter, so its rows really do change.
      queryClient.invalidateQueries({ queryKey: ["notes", organizationId] });

      if (response.isBookmarked) {
        queryClient.invalidateQueries({ queryKey: ["bookmark-items", organizationId] });
        return;
      }
      queryClient.setQueriesData<InfiniteData<BookmarkItemsPage>>(
        { queryKey: ["bookmark-items", organizationId] },
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: page.items.filter((item) => item.urn !== urn),
            })),
          },
      );
    },
  });
}
