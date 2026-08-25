import { configureStore } from "@reduxjs/toolkit";
import { create, toJsonString } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";
import {
  SearchResultType,
  UrnAvailability,
  UrnMetadataSchema,
} from "@uniffy/proto/search/v1/search_pb";
import {
  bookmarksReducer,
  fetchBookmarkItems,
  type SerializedBookmarkItem,
} from "@/features/bookmarks/store/bookmarksSlice";
import { clearLibraryScope } from "@/features/library/store/clearLibraryScope";
import { fetchContentGraph, libraryGraphReducer } from "@/features/library/store/graphSlice";
import {
  clearUrnMetadataCache,
  urnMetadataCacheForScope,
  type CachedUrnMetadata,
} from "@/features/search/utils/urnMetadataCache";

const tenantAUrn = "urn:uniffy:content:NOTE:tenant-a-note";

const tenantABookmark: SerializedBookmarkItem = {
  id: "tenant-a-bookmark",
  urn: tenantAUrn,
  createdAt: "2026-08-24T12:00:00.000Z",
  content: {
    title: "Tenant A strategy",
    description: "Tenant A confidential preview",
    type: SearchResultType.NOTE,
    url: "/notes/tenant-a-note",
    availability: UrnAvailability.AVAILABLE,
    metadata: {},
  },
  contentJson: toJsonString(
    UrnMetadataSchema,
    create(UrnMetadataSchema, {
      title: "Tenant A strategy",
      description: "Tenant A confidential preview",
      type: SearchResultType.NOTE,
      url: "/notes/tenant-a-note",
      availability: UrnAvailability.AVAILABLE,
    }),
  ),
};

afterEach(() => {
  clearUrnMetadataCache();
});

describe("clearLibraryScope", () => {
  it("removes tenant A bookmark previews, graph edges, and metadata before tenant B loads", () => {
    const store = configureStore({
      reducer: {
        bookmarks: bookmarksReducer,
        libraryGraph: libraryGraphReducer,
      },
    });

    store.dispatch(
      fetchBookmarkItems.fulfilled(
        {
          scope: "page",
          items: [tenantABookmark],
          nextPageToken: null,
          append: false,
        },
        "bookmarks-a",
        { scope: "page" },
      ),
    );
    store.dispatch(fetchContentGraph.pending("graph-a", "organization-a"));
    store.dispatch(
      fetchContentGraph.fulfilled(
        {
          organizationId: "organization-a",
          edges: [{ sourceUrn: tenantAUrn, targetUrn: "urn:uniffy:content:TASK:tenant-a-task" }],
          truncated: false,
          fetchedAt: 1,
        },
        "graph-a",
        "organization-a",
      ),
    );
    urnMetadataCacheForScope("organization-a", "user-a").set(tenantAUrn, {
      title: "Tenant A strategy",
    } as CachedUrnMetadata);

    clearLibraryScope(store.dispatch);

    expect(store.getState().bookmarks.resolved.page.items).toEqual([]);
    expect(store.getState().libraryGraph.edges).toEqual([]);
    expect(store.getState().libraryGraph.organizationId).toBeNull();
    expect(urnMetadataCacheForScope("organization-b", "user-a").has(tenantAUrn)).toBe(false);
  });
});
