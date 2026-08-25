import { describe, expect, it } from "vitest";
import { create, toJsonString } from "@bufbuild/protobuf";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import {
  SearchResultType,
  UrnAvailability,
  UrnMetadataSchema,
} from "@uniffy/proto/search/v1/search_pb";
import {
  bookmarkItemsCriteriaKey,
  bookmarksReducer,
  bulkCheckBookmarks,
  clearBookmarks,
  fetchBookmarkItems,
  toggleBookmark,
  type FetchBookmarkItemsArgs,
  type SerializedBookmarkItem,
} from "@/features/bookmarks/store/bookmarksSlice";

function item(id: string, urn: string): SerializedBookmarkItem {
  return {
    id,
    urn,
    createdAt: "2026-08-22T10:00:00.000Z",
    content: {
      title: `Title ${id}`,
      description: "",
      type: SearchResultType.NOTE,
      url: `/notes/${id}`,
      availability: UrnAvailability.AVAILABLE,
      metadata: {},
    },
    contentJson: toJsonString(
      UrnMetadataSchema,
      create(UrnMetadataSchema, {
        title: `Title ${id}`,
        type: SearchResultType.NOTE,
        url: `/notes/${id}`,
        availability: UrnAvailability.AVAILABLE,
      }),
    ),
  };
}

const fetchArgs = { scope: "page" as const };

function resolveItems(
  state: ReturnType<typeof bookmarksReducer> | undefined,
  requestId: string,
  args: FetchBookmarkItemsArgs,
  items: SerializedBookmarkItem[],
  nextPageToken: string | null,
) {
  const pending = bookmarksReducer(state, fetchBookmarkItems.pending(requestId, args));
  return bookmarksReducer(
    pending,
    fetchBookmarkItems.fulfilled(
      {
        scope: args.scope,
        items,
        nextPageToken,
        append: !!args.pageToken,
      },
      requestId,
      args,
    ),
  );
}

describe("bookmarksSlice resolved items", () => {
  it("recovers an unseeded bookmark from an authoritative visible-item check", () => {
    const visibleUrn = "urn:uniffy:content:NOTE:older-visible";
    let state = bookmarksReducer(undefined, { type: "@@init" });

    expect(state.bookmarkedUrns[visibleUrn]).toBeUndefined();
    expect(state.checkedUrns[visibleUrn]).toBeUndefined();

    state = bookmarksReducer(state, bulkCheckBookmarks.pending("visible-check", [visibleUrn]));
    state = bookmarksReducer(
      state,
      bulkCheckBookmarks.fulfilled({ [visibleUrn]: true }, "visible-check", [visibleUrn]),
    );

    expect(state.bookmarkedUrns[visibleUrn]).toBe(true);
    expect(state.checkedUrns[visibleUrn]).toBe(true);
    expect(state.checkingUrns[visibleUrn]).toBe(false);
  });

  it("replaces the page bucket on a fresh fetch and marks urns as bookmarked", () => {
    const state = resolveItems(
      undefined,
      "r1",
      fetchArgs,
      [item("a", "urn:uniffy:content:NOTE:a")],
      "cursor-1",
    );

    expect(state.resolved.page.items).toHaveLength(1);
    expect(state.resolved.page.status).toBe("succeeded");
    expect(state.resolved.page.nextPageToken).toBe("cursor-1");
    expect(state.bookmarkedUrns["urn:uniffy:content:NOTE:a"]).toBe(true);
    expect(state.resolved.widget.items).toHaveLength(0);
  });

  it("appends without duplicating already-loaded bookmarks", () => {
    let state = resolveItems(
      undefined,
      "r1",
      fetchArgs,
      [item("a", "urn:uniffy:content:NOTE:a")],
      "cursor-1",
    );

    state = resolveItems(
      state,
      "r2",
      { scope: "page", pageToken: "cursor-1" },
      [item("a", "urn:uniffy:content:NOTE:a"), item("b", "urn:uniffy:content:NOTE:b")],
      null,
    );

    expect(state.resolved.page.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(state.resolved.page.nextPageToken).toBeNull();
  });

  it("tracks loading and loadingMore separately from the page token", () => {
    let state = bookmarksReducer(undefined, fetchBookmarkItems.pending("r1", fetchArgs));
    expect(state.resolved.page.status).toBe("loading");

    state = bookmarksReducer(
      state,
      fetchBookmarkItems.pending("r2", { scope: "page", pageToken: "cursor-1" }),
    );
    expect(state.resolved.page.status).toBe("loadingMore");
  });

  it("records the failure on the requested bucket only", () => {
    let state = bookmarksReducer(undefined, fetchBookmarkItems.pending("r1", { scope: "widget" }));
    state = bookmarksReducer(
      state,
      fetchBookmarkItems.rejected(new Error("boom"), "r1", { scope: "widget" }, "boom"),
    );
    expect(state.resolved.widget.status).toBe("failed");
    expect(state.resolved.widget.error).toBe("boom");
    expect(state.resolved.page.status).toBe("idle");
  });

  it("removes an unbookmarked item from every resolved bucket", () => {
    let state = resolveItems(
      undefined,
      "r1",
      fetchArgs,
      [item("a", "urn:uniffy:content:NOTE:a"), item("b", "urn:uniffy:content:NOTE:b")],
      null,
    );
    state = resolveItems(
      state,
      "r2",
      { scope: "widget" },
      [item("a", "urn:uniffy:content:NOTE:a")],
      null,
    );

    state = bookmarksReducer(state, toggleBookmark.pending("r3", "urn:uniffy:content:NOTE:a"));
    state = bookmarksReducer(
      state,
      toggleBookmark.fulfilled(
        { urn: "urn:uniffy:content:NOTE:a", isBookmarked: false, bookmark: null },
        "r3",
        "urn:uniffy:content:NOTE:a",
      ),
    );

    expect(state.resolved.page.items.map((i) => i.id)).toEqual(["b"]);
    expect(state.resolved.widget.items).toHaveLength(0);
    expect(state.bookmarkedUrns["urn:uniffy:content:NOTE:a"]).toBe(false);
  });

  it("ignores bookmark responses whose requests were cleared", () => {
    const urn = "urn:uniffy:content:NOTE:a";
    let state = bookmarksReducer(undefined, bulkCheckBookmarks.pending("check-a", [urn]));
    state = bookmarksReducer(state, toggleBookmark.pending("toggle-a", urn));
    state = bookmarksReducer(state, clearBookmarks());
    state = bookmarksReducer(
      state,
      bulkCheckBookmarks.fulfilled({ [urn]: true }, "check-a", [urn]),
    );
    state = bookmarksReducer(
      state,
      toggleBookmark.fulfilled({ urn, isBookmarked: true, bookmark: null }, "toggle-a", urn),
    );

    expect(state.bookmarkedUrns[urn]).toBeUndefined();
    expect(state.checkedUrns[urn]).toBeUndefined();
    expect(state.checkingUrns[urn]).toBeUndefined();
    expect(state.toggling[urn]).toBeUndefined();
  });

  it("ignores a late page from the previous content-type filter", () => {
    const notesArgs: FetchBookmarkItemsArgs = {
      scope: "page",
      contentTypes: [ContentType.NOTE],
    };
    const notesMoreArgs = { ...notesArgs, pageToken: "notes-cursor" };
    const filesArgs: FetchBookmarkItemsArgs = {
      scope: "page",
      contentTypes: [ContentType.FILE],
    };
    let state = resolveItems(
      undefined,
      "notes-initial",
      notesArgs,
      [item("note-a", "urn:uniffy:content:NOTE:note-a")],
      "notes-cursor",
    );
    state = bookmarksReducer(state, fetchBookmarkItems.pending("notes-more", notesMoreArgs));
    state = bookmarksReducer(state, fetchBookmarkItems.pending("files-fresh", filesArgs));

    expect(state.resolved.page.items).toEqual([]);
    expect(state.resolved.page.criteriaKey).toBe(bookmarkItemsCriteriaKey(filesArgs));

    state = bookmarksReducer(
      state,
      fetchBookmarkItems.fulfilled(
        {
          scope: "page",
          items: [item("file-a", "urn:uniffy:content:FILE:file-a")],
          nextPageToken: null,
          append: false,
        },
        "files-fresh",
        filesArgs,
      ),
    );
    state = bookmarksReducer(
      state,
      fetchBookmarkItems.fulfilled(
        {
          scope: "page",
          items: [item("note-b", "urn:uniffy:content:NOTE:note-b")],
          nextPageToken: null,
          append: true,
        },
        "notes-more",
        notesMoreArgs,
      ),
    );

    expect(state.resolved.page.items.map((entry) => entry.id)).toEqual(["file-a"]);
    expect(state.bookmarkedUrns["urn:uniffy:content:NOTE:note-b"]).toBeUndefined();
    expect(state.resolved.page.activeRequestId).toBeNull();
  });

  it("resets resolved buckets with the rest of the slice", () => {
    let state = resolveItems(
      undefined,
      "r1",
      fetchArgs,
      [item("a", "urn:uniffy:content:NOTE:a")],
      "cursor-1",
    );
    state = bookmarksReducer(state, clearBookmarks());

    expect(state.resolved.page.items).toHaveLength(0);
    expect(state.resolved.page.status).toBe("idle");
    expect(state.resolved.page.nextPageToken).toBeNull();
    expect(state.resolved.page.criteriaKey).toBeNull();
    expect(state.resolved.page.activeRequestId).toBeNull();
  });
});
