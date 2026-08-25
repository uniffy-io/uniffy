import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import type { PayloadAction, ThunkAction, UnknownAction } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import { create, toJsonString } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { bookmarksApi } from "@/features/bookmarks/api/bookmarksApi";
import type { Bookmark, BookmarkItem } from "@uniffy/proto/bookmarks/v1/bookmarks_pb";
import type { ContentType } from "@uniffy/proto/common/v1/common_pb";
import {
  SearchResultType,
  UrnAvailability,
  UrnMetadataSchema,
} from "@uniffy/proto/search/v1/search_pb";
import { bookmarkCheckBatches } from "@/features/bookmarks/utils/bookmarkChecks";
import {
  BOOKMARK_MAX_PAGES_PER_FETCH,
  isDisplayableBookmarkItem,
} from "@/features/bookmarks/utils/bookmarkItems";

export interface SerializedBookmark {
  id: string;
  userId: string;
  organizationId: string;
  urn: string;
  createdAt: string;
}

export interface SerializedBookmarkContent {
  title: string;
  description: string;
  type: SearchResultType;
  url: string;
  availability: UrnAvailability;
  metadata: Record<string, string>;
}

export interface SerializedBookmarkItem {
  id: string;
  urn: string;
  createdAt: string;
  content: SerializedBookmarkContent;
  contentJson: string;
}

export type BookmarkItemsScope = "page" | "widget";

export interface BookmarkItemsBucket {
  items: SerializedBookmarkItem[];
  status: "idle" | "loading" | "loadingMore" | "succeeded" | "failed";
  nextPageToken: string | null;
  error: string | null;
  criteriaKey: string | null;
  activeRequestId: string | null;
}

const emptyBucket = (): BookmarkItemsBucket => ({
  items: [],
  status: "idle",
  nextPageToken: null,
  error: null,
  criteriaKey: null,
  activeRequestId: null,
});

export interface BookmarksState {
  /** URN -> bookmarked? - fast lookup for components. */
  bookmarkedUrns: Record<string, boolean>;
  /** URNs whose saved state came from an authoritative response. */
  checkedUrns: Record<string, boolean>;
  /** Per-URN bulk-check in-flight flag. */
  checkingUrns: Record<string, boolean>;
  /** Latest bulk-check request allowed to update each URN. */
  checkingRequestIds: Record<string, string>;
  /** Per-URN toggle in-flight flag. */
  toggling: Record<string, boolean>;
  /** Latest toggle request allowed to update each URN. */
  toggleRequestIds: Record<string, string>;
  error: string | null;
  /** Resolved previews; the page and the dashboard widget paginate independently. */
  resolved: Record<BookmarkItemsScope, BookmarkItemsBucket>;
  /** Bumped when a new bookmark lands, so mounted lists refetch instead of missing it. */
  resolvedRevision: number;
}

const initialState: BookmarksState = {
  bookmarkedUrns: {},
  checkedUrns: {},
  checkingUrns: {},
  checkingRequestIds: {},
  toggling: {},
  toggleRequestIds: {},
  error: null,
  resolved: { page: emptyBucket(), widget: emptyBucket() },
  resolvedRevision: 0,
};

const bookmarkToPlain = (bookmark: Bookmark): SerializedBookmark => ({
  id: bookmark.id,
  userId: bookmark.userId,
  organizationId: bookmark.organizationId,
  urn: bookmark.urn,
  createdAt: (bookmark.createdAt ? timestampDate(bookmark.createdAt) : new Date()).toISOString(),
});

const bookmarkItemToPlain = (item: BookmarkItem): SerializedBookmarkItem | null => {
  if (!item.bookmark) return null;
  const content =
    item.content ??
    create(UrnMetadataSchema, {
      availability: UrnAvailability.UNAVAILABLE,
    });
  return {
    id: item.bookmark.id,
    urn: item.bookmark.urn,
    createdAt: (item.bookmark.createdAt
      ? timestampDate(item.bookmark.createdAt)
      : new Date()
    ).toISOString(),
    content: {
      title: content.title,
      description: content.description,
      type: content.type,
      url: content.url,
      availability: content.availability,
      metadata: { ...content.metadata },
    },
    contentJson: toJsonString(UrnMetadataSchema, content),
  };
};

export const toggleBookmark = createAsyncThunk<
  { urn: string; isBookmarked: boolean; bookmark: SerializedBookmark | null },
  string,
  { state: RootState; rejectValue: string }
>("bookmarks/toggleBookmark", async (urn, { getState, rejectWithValue }) => {
  const organizationId = getState().auth.currentOrganizationId;
  if (!organizationId) {
    return rejectWithValue("No organization selected");
  }

  try {
    const response = await bookmarksApi.toggleBookmark({
      organizationId,
      urn,
    });

    return {
      urn,
      isBookmarked: response.isBookmarked,
      bookmark: response.bookmark ? bookmarkToPlain(response.bookmark) : null,
    };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to toggle bookmark");
  }
});

export interface FetchBookmarkItemsArgs {
  scope: BookmarkItemsScope;
  contentTypes?: ContentType[];
  pageSize?: number;
  pageToken?: string;
}

export function bookmarkItemsCriteriaKey(
  args: Pick<FetchBookmarkItemsArgs, "contentTypes" | "pageSize">,
): string {
  const contentTypes = [...new Set(args.contentTypes ?? [])].sort((a, b) => a - b);
  return JSON.stringify({ contentTypes, pageSize: args.pageSize ?? 50 });
}

export const fetchBookmarkItems = createAsyncThunk<
  {
    scope: BookmarkItemsScope;
    items: SerializedBookmarkItem[];
    nextPageToken: string | null;
    append: boolean;
  },
  FetchBookmarkItemsArgs,
  { state: RootState; rejectValue: string }
>("bookmarks/fetchBookmarkItems", async (args, { getState, rejectWithValue }) => {
  const organizationId = getState().auth.currentOrganizationId;
  if (!organizationId) {
    return rejectWithValue("No organization selected");
  }

  try {
    const pageSize = args.pageSize ?? 50;
    const items: SerializedBookmarkItem[] = [];
    let pageToken = args.pageToken;
    let nextPageToken: string | null = null;
    let displayableCount = 0;

    for (let page = 0; page < BOOKMARK_MAX_PAGES_PER_FETCH; page += 1) {
      const response = await bookmarksApi.listBookmarkItems({
        organizationId,
        contentTypes: args.contentTypes ?? [],
        pageSize,
        pageToken,
      });
      const pageItems = response.items
        .map(bookmarkItemToPlain)
        .filter((item): item is SerializedBookmarkItem => item !== null);
      items.push(...pageItems);
      displayableCount += pageItems.filter(isDisplayableBookmarkItem).length;
      nextPageToken = response.nextPageToken ?? null;

      // The widget only renders openable cards, so it keeps scanning until it has
      // a full set. Every other scope just needs this fetch to yield something.
      const satisfied = args.scope === "widget" ? displayableCount >= pageSize : items.length > 0;
      if (!nextPageToken || satisfied) {
        break;
      }
      pageToken = nextPageToken;
    }

    return {
      scope: args.scope,
      items,
      nextPageToken,
      append: !!args.pageToken,
    };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to load bookmarks");
  }
});

export const bulkCheckBookmarks = createAsyncThunk<
  Record<string, boolean>,
  string[],
  { state: RootState; rejectValue: string }
>("bookmarks/bulkCheckBookmarks", async (urns, { getState, rejectWithValue }) => {
  const organizationId = getState().auth.currentOrganizationId;
  if (!organizationId) {
    return rejectWithValue("No organization selected");
  }

  if (urns.length === 0) {
    return {};
  }

  try {
    const bookmarkedUrns: Record<string, boolean> = {};
    for (const batch of bookmarkCheckBatches(urns)) {
      const response = await bookmarksApi.bulkCheckBookmarks({
        organizationId,
        urns: batch,
      });
      Object.assign(bookmarkedUrns, response.bookmarkedUrns);
    }

    return bookmarkedUrns;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to check bookmarks");
  }
});

export const toggleBookmarkSafely = (
  urn: string,
): ThunkAction<Promise<void>, RootState, unknown, UnknownAction> => {
  return async (dispatch, getState) => {
    const bookmarkState = getState().bookmarks;
    if (!urn || bookmarkState.toggling[urn] || bookmarkState.checkingUrns[urn]) return;

    const organizationId = getState().auth.currentOrganizationId;
    if (!organizationId) return;

    const displayedStatus = bookmarkState.bookmarkedUrns[urn] ?? false;
    if (!bookmarkState.checkedUrns[urn]) {
      let actualStatus: boolean;
      try {
        const statuses = await dispatch(bulkCheckBookmarks([urn])).unwrap();
        actualStatus = statuses[urn] ?? false;
      } catch {
        return;
      }
      if (getState().auth.currentOrganizationId !== organizationId) return;
      if (actualStatus !== displayedStatus) return;
    }

    if (getState().auth.currentOrganizationId !== organizationId) return;
    await dispatch(toggleBookmark(urn));
  };
};

export const addBookmarksSafely = (
  urns: string[],
): ThunkAction<Promise<void>, RootState, unknown, UnknownAction> => {
  return async (dispatch, getState) => {
    const organizationId = getState().auth.currentOrganizationId;
    if (!organizationId) return;

    let statuses: Record<string, boolean>;
    try {
      statuses = await dispatch(bulkCheckBookmarks(urns)).unwrap();
    } catch {
      return;
    }

    for (const urn of [...new Set(urns)]) {
      if (getState().auth.currentOrganizationId !== organizationId) return;
      if (statuses[urn]) continue;
      await dispatch(toggleBookmark(urn));
    }
  };
};

const bookmarksSlice = createSlice({
  name: "bookmarks",
  initialState,
  reducers: {
    clearBookmarks: () => initialState,

    setBookmarkStatus: (state, action: PayloadAction<{ urn: string; isBookmarked: boolean }>) => {
      state.bookmarkedUrns[action.payload.urn] = action.payload.isBookmarked;
      state.checkedUrns[action.payload.urn] = true;
    },

    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(toggleBookmark.pending, (state, action) => {
        state.toggling[action.meta.arg] = true;
        state.toggleRequestIds[action.meta.arg] = action.meta.requestId;
      })
      .addCase(toggleBookmark.fulfilled, (state, action) => {
        const { urn, isBookmarked } = action.payload;
        if (state.toggleRequestIds[urn] !== action.meta.requestId) return;

        state.toggling[urn] = false;
        delete state.toggleRequestIds[urn];

        state.bookmarkedUrns[urn] = isBookmarked;
        state.checkedUrns[urn] = true;

        if (isBookmarked) {
          // Only the server can place the new item in keyset order and resolve
          // its preview, so mounted lists refetch rather than splice locally.
          state.resolvedRevision += 1;
        } else {
          for (const bucket of Object.values(state.resolved)) {
            bucket.items = bucket.items.filter((item) => item.urn !== urn);
          }
        }
      })
      .addCase(toggleBookmark.rejected, (state, action) => {
        if (state.toggleRequestIds[action.meta.arg] !== action.meta.requestId) return;

        state.toggling[action.meta.arg] = false;
        delete state.toggleRequestIds[action.meta.arg];
        state.error = action.payload ?? "Failed to toggle bookmark";
      });

    builder
      .addCase(fetchBookmarkItems.pending, (state, action) => {
        const bucket = state.resolved[action.meta.arg.scope];
        const criteriaKey = bookmarkItemsCriteriaKey(action.meta.arg);
        if (action.meta.arg.pageToken && bucket.criteriaKey !== criteriaKey) return;

        if (!action.meta.arg.pageToken && bucket.criteriaKey !== criteriaKey) {
          bucket.items = [];
          bucket.nextPageToken = null;
        }
        bucket.criteriaKey = criteriaKey;
        bucket.activeRequestId = action.meta.requestId;
        bucket.status = action.meta.arg.pageToken ? "loadingMore" : "loading";
        bucket.error = null;
      })
      .addCase(fetchBookmarkItems.fulfilled, (state, action) => {
        const { scope, items, nextPageToken, append } = action.payload;
        const bucket = state.resolved[scope];
        const criteriaKey = bookmarkItemsCriteriaKey(action.meta.arg);
        if (
          bucket.criteriaKey !== criteriaKey ||
          bucket.activeRequestId !== action.meta.requestId
        ) {
          return;
        }

        bucket.activeRequestId = null;
        bucket.status = "succeeded";
        bucket.nextPageToken = nextPageToken;

        if (append) {
          const known = new Set(bucket.items.map((item) => item.id));
          bucket.items.push(...items.filter((item) => !known.has(item.id)));
        } else {
          bucket.items = items;
        }

        for (const item of items) {
          state.bookmarkedUrns[item.urn] = true;
          state.checkedUrns[item.urn] = true;
        }
      })
      .addCase(fetchBookmarkItems.rejected, (state, action) => {
        const bucket = state.resolved[action.meta.arg.scope];
        const criteriaKey = bookmarkItemsCriteriaKey(action.meta.arg);
        if (
          bucket.criteriaKey !== criteriaKey ||
          bucket.activeRequestId !== action.meta.requestId
        ) {
          return;
        }

        bucket.activeRequestId = null;
        bucket.status = "failed";
        bucket.error = action.payload ?? "Failed to load bookmarks";
      });

    builder
      .addCase(bulkCheckBookmarks.pending, (state, action) => {
        for (const urn of action.meta.arg) {
          state.checkingUrns[urn] = true;
          state.checkingRequestIds[urn] = action.meta.requestId;
        }
      })
      .addCase(bulkCheckBookmarks.fulfilled, (state, action) => {
        for (const urn of action.meta.arg) {
          if (state.checkingRequestIds[urn] !== action.meta.requestId) continue;

          if (Object.hasOwn(action.payload, urn)) {
            state.bookmarkedUrns[urn] = action.payload[urn];
            state.checkedUrns[urn] = true;
          }
          state.checkingUrns[urn] = false;
          delete state.checkingRequestIds[urn];
        }
      })
      .addCase(bulkCheckBookmarks.rejected, (state, action) => {
        let handled = false;
        for (const urn of action.meta.arg) {
          if (state.checkingRequestIds[urn] !== action.meta.requestId) continue;

          handled = true;
          state.checkingUrns[urn] = false;
          delete state.checkingRequestIds[urn];
        }
        if (handled) {
          state.error = action.payload ?? "Failed to check bookmarks";
        }
      });
  },
});

export const { clearBookmarks, setBookmarkStatus, clearError } = bookmarksSlice.actions;
export const bookmarksReducer = bookmarksSlice.reducer;
