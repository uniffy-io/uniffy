import { configureStore } from "@reduxjs/toolkit";
import { create, fromJsonString } from "@bufbuild/protobuf";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SearchResultType,
  UrnAvailability,
  UrnMetadataSchema,
} from "@uniffy/proto/search/v1/search_pb";
import { authReducer, setCredentials } from "@/features/auth/store/authSlice";
import { bookmarksApi } from "@/features/bookmarks/api/bookmarksApi";
import { bookmarksReducer, fetchBookmarkItems } from "@/features/bookmarks/store/bookmarksSlice";
import {
  BOOKMARK_MAX_PAGES_PER_FETCH,
  isDisplayableBookmarkItem,
} from "@/features/bookmarks/utils/bookmarkItems";

vi.mock("@/features/bookmarks/api/bookmarksApi", () => ({
  bookmarksApi: {
    listBookmarkItems: vi.fn(),
  },
}));

function bookmarkStore() {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      bookmarks: bookmarksReducer,
    },
  });
  store.dispatch(
    setCredentials({
      user: { id: "user-1" } as never,
      accessToken: "access-token",
      refreshToken: "refresh-token",
      organizationId: "organization-1",
    }),
  );
  return store;
}

function bookmarkItem(id: string, availability: UrnAvailability, url = "") {
  return {
    bookmark: {
      id,
      urn: `urn:uniffy:content:NOTE:${id}`,
    },
    content: create(UrnMetadataSchema, {
      title: `Title ${id}`,
      description: "",
      type: SearchResultType.NOTE,
      url,
      availability,
      metadata: {},
    }),
  };
}

async function loadWidget(store: ReturnType<typeof bookmarkStore>) {
  const dispatchFetch = store.dispatch as unknown as (
    action: ReturnType<typeof fetchBookmarkItems>,
  ) => Promise<unknown>;
  await dispatchFetch(fetchBookmarkItems({ scope: "widget", pageSize: 6 }));
}

beforeEach(() => {
  vi.mocked(bookmarksApi.listBookmarkItems).mockReset();
});

describe("dashboard bookmark pagination", () => {
  it("keeps the full authorized metadata projection for mention hydration", async () => {
    const resolved = bookmarkItem("note-folder", UrnAvailability.AVAILABLE, "/notes/folder");
    resolved.content = create(UrnMetadataSchema, {
      ...resolved.content,
      noteNodeType: "FOLDER",
      contentTags: ["Planning"],
    });
    vi.mocked(bookmarksApi.listBookmarkItems).mockResolvedValueOnce({
      items: [resolved],
      nextPageToken: undefined,
    } as never);
    const store = bookmarkStore();

    await loadWidget(store);

    const item = store.getState().bookmarks.resolved.widget.items[0];
    const metadata = fromJsonString(UrnMetadataSchema, item.contentJson);
    expect(metadata.noteNodeType).toBe("FOLDER");
    expect(metadata.contentTags).toEqual(["Planning"]);
  });

  it("continues past a tombstone-only page to find an available bookmark", async () => {
    const tombstones = Array.from({ length: 6 }, (_, index) =>
      bookmarkItem(`deleted-${index}`, UrnAvailability.DELETED),
    );
    const available = bookmarkItem("available", UrnAvailability.AVAILABLE, "/notes/available");
    vi.mocked(bookmarksApi.listBookmarkItems)
      .mockResolvedValueOnce({ items: tombstones, nextPageToken: "cursor-1" } as never)
      .mockResolvedValueOnce({ items: [available], nextPageToken: undefined } as never);
    const store = bookmarkStore();

    await loadWidget(store);

    expect(bookmarksApi.listBookmarkItems).toHaveBeenNthCalledWith(1, {
      organizationId: "organization-1",
      contentTypes: [],
      pageSize: 6,
      pageToken: undefined,
    });
    expect(bookmarksApi.listBookmarkItems).toHaveBeenNthCalledWith(2, {
      organizationId: "organization-1",
      contentTypes: [],
      pageSize: 6,
      pageToken: "cursor-1",
    });
    expect(
      store.getState().bookmarks.resolved.widget.items.filter(isDisplayableBookmarkItem),
    ).toEqual([
      expect.objectContaining({ id: "available", urn: "urn:uniffy:content:NOTE:available" }),
    ]);
    expect(store.getState().bookmarks.resolved.widget.status).toBe("succeeded");
  });

  it("stops scanning after the dashboard page bound", async () => {
    for (let page = 0; page < BOOKMARK_MAX_PAGES_PER_FETCH; page += 1) {
      vi.mocked(bookmarksApi.listBookmarkItems).mockResolvedValueOnce({
        items: Array.from({ length: 6 }, (_, index) =>
          bookmarkItem(`deleted-${page}-${index}`, UrnAvailability.DELETED),
        ),
        nextPageToken: `cursor-${page + 1}`,
      } as never);
    }
    const store = bookmarkStore();

    await loadWidget(store);

    expect(bookmarksApi.listBookmarkItems).toHaveBeenCalledTimes(BOOKMARK_MAX_PAGES_PER_FETCH);
    expect(store.getState().bookmarks.resolved.widget.nextPageToken).toBe(
      `cursor-${BOOKMARK_MAX_PAGES_PER_FETCH}`,
    );
  });
});

describe("library page pagination", () => {
  it("continues past an empty token-bearing page instead of dead-ending", async () => {
    vi.mocked(bookmarksApi.listBookmarkItems)
      .mockResolvedValueOnce({ items: [], nextPageToken: "cursor-1" } as never)
      .mockResolvedValueOnce({
        items: [bookmarkItem("older", UrnAvailability.AVAILABLE, "/notes/older")],
        nextPageToken: undefined,
      } as never);
    const store = bookmarkStore();
    const dispatchFetch = store.dispatch as unknown as (
      action: ReturnType<typeof fetchBookmarkItems>,
    ) => Promise<unknown>;

    await dispatchFetch(fetchBookmarkItems({ scope: "page", pageSize: 50 }));

    expect(bookmarksApi.listBookmarkItems).toHaveBeenCalledTimes(2);
    expect(store.getState().bookmarks.resolved.page.items).toEqual([
      expect.objectContaining({ id: "older" }),
    ]);
    expect(store.getState().bookmarks.resolved.page.nextPageToken).toBeNull();
  });

  it("keeps the continuation token when the whole scan budget is unreadable", async () => {
    for (let page = 0; page < BOOKMARK_MAX_PAGES_PER_FETCH; page += 1) {
      vi.mocked(bookmarksApi.listBookmarkItems).mockResolvedValueOnce({
        items: [],
        nextPageToken: `cursor-${page + 1}`,
      } as never);
    }
    const store = bookmarkStore();
    const dispatchFetch = store.dispatch as unknown as (
      action: ReturnType<typeof fetchBookmarkItems>,
    ) => Promise<unknown>;

    await dispatchFetch(fetchBookmarkItems({ scope: "page", pageSize: 50 }));

    const bucket = store.getState().bookmarks.resolved.page;
    expect(bucket.items).toEqual([]);
    // hasMore stays true, so the surface renders "Load more" rather than "Nothing saved yet".
    expect(bucket.nextPageToken).toBe(`cursor-${BOOKMARK_MAX_PAGES_PER_FETCH}`);
  });
});
