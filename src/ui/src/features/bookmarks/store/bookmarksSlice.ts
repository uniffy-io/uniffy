import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { bookmarksApi } from "@/features/bookmarks/api/bookmarksApi";
import type { Bookmark } from "@uniffy/proto/bookmarks/v1/bookmarks_pb";

export interface SerializedBookmark {
  id: string;
  userId: string;
  organizationId: string;
  urn: string;
  createdAt: string;
}

export interface BookmarksState {
  /** URN -> bookmarked? - fast lookup for components. */
  bookmarkedUrns: Record<string, boolean>;
  bookmarks: Record<string, SerializedBookmark>;
  loading: boolean;
  /** Per-URN toggle in-flight flag. */
  toggling: Record<string, boolean>;
  error: string | null;
  totalCount: number;
}

const initialState: BookmarksState = {
  bookmarkedUrns: {},
  bookmarks: {},
  loading: false,
  toggling: {},
  error: null,
  totalCount: 0,
};

const bookmarkToPlain = (bookmark: Bookmark): SerializedBookmark => ({
  id: bookmark.id,
  userId: bookmark.userId,
  organizationId: bookmark.organizationId,
  urn: bookmark.urn,
  createdAt: (bookmark.createdAt ? timestampDate(bookmark.createdAt) : new Date()).toISOString(),
});

export const fetchBookmarks = createAsyncThunk<
  { bookmarks: SerializedBookmark[]; totalCount: number },
  void,
  { state: RootState; rejectValue: string }
>("bookmarks/fetchBookmarks", async (_, { getState, rejectWithValue }) => {
  const organizationId = getState().auth.currentOrganizationId;
  if (!organizationId) {
    return rejectWithValue("No organization selected");
  }

  try {
    const response = await bookmarksApi.listBookmarks({
      organizationId,
      page: 1,
      pageSize: 100,
    });

    return {
      bookmarks: response.bookmarks.map(bookmarkToPlain),
      totalCount: response.totalCount,
    };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch bookmarks");
  }
});

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
    const response = await bookmarksApi.bulkCheckBookmarks({
      organizationId,
      urns,
    });

    return response.bookmarkedUrns;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to check bookmarks");
  }
});

const bookmarksSlice = createSlice({
  name: "bookmarks",
  initialState,
  reducers: {
    clearBookmarks: () => initialState,

    setBookmarkStatus: (state, action: PayloadAction<{ urn: string; isBookmarked: boolean }>) => {
      state.bookmarkedUrns[action.payload.urn] = action.payload.isBookmarked;
    },

    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchBookmarks.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchBookmarks.fulfilled, (state, action) => {
        state.loading = false;
        state.totalCount = action.payload.totalCount;

        state.bookmarkedUrns = {};
        state.bookmarks = {};

        for (const bookmark of action.payload.bookmarks) {
          state.bookmarkedUrns[bookmark.urn] = true;
          state.bookmarks[bookmark.urn] = bookmark;
        }
      })
      .addCase(fetchBookmarks.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? "Failed to fetch bookmarks";
      });

    builder
      .addCase(toggleBookmark.pending, (state, action) => {
        state.toggling[action.meta.arg] = true;
      })
      .addCase(toggleBookmark.fulfilled, (state, action) => {
        const { urn, isBookmarked, bookmark } = action.payload;
        state.toggling[urn] = false;

        state.bookmarkedUrns[urn] = isBookmarked;

        if (isBookmarked && bookmark) {
          state.bookmarks[urn] = bookmark;
          state.totalCount += 1;
        } else {
          delete state.bookmarks[urn];
          state.totalCount = Math.max(0, state.totalCount - 1);
        }
      })
      .addCase(toggleBookmark.rejected, (state, action) => {
        state.toggling[action.meta.arg] = false;
        state.error = action.payload ?? "Failed to toggle bookmark";
      });

    builder
      .addCase(bulkCheckBookmarks.fulfilled, (state, action) => {
        for (const [urn, isBookmarked] of Object.entries(action.payload)) {
          state.bookmarkedUrns[urn] = isBookmarked;
        }
      })
      .addCase(bulkCheckBookmarks.rejected, (state, action) => {
        state.error = action.payload ?? "Failed to check bookmarks";
      });
  },
});

export const { clearBookmarks, setBookmarkStatus, clearError } = bookmarksSlice.actions;
export const bookmarksReducer = bookmarksSlice.reducer;
