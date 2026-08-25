import { createClient } from "@connectrpc/connect";
import { unaryTransport } from "@/config/api";
import {
  BookmarksService,
  BulkCheckBookmarksRequestSchema,
  ListBookmarkItemsRequestSchema,
  ToggleBookmarkRequestSchema,
} from "@uniffy/proto/bookmarks/v1/bookmarks_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";

const bookmarksClient = createClient(BookmarksService, unaryTransport);

export const bookmarksApi = {
  toggleBookmark: async (request: MessageInitShape<typeof ToggleBookmarkRequestSchema>) => {
    return bookmarksClient.toggleBookmark(request);
  },

  listBookmarkItems: async (request: MessageInitShape<typeof ListBookmarkItemsRequestSchema>) => {
    return bookmarksClient.listBookmarkItems(request);
  },

  bulkCheckBookmarks: async (request: MessageInitShape<typeof BulkCheckBookmarksRequestSchema>) => {
    return bookmarksClient.bulkCheckBookmarks(request);
  },
};
