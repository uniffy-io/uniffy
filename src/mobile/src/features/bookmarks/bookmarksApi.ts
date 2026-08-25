import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  BookmarksService,
  BulkCheckBookmarksRequestSchema,
  ListBookmarkItemsRequestSchema,
  ToggleBookmarkRequestSchema,
} from "@uniffy/proto/bookmarks/v1/bookmarks_pb";
import { transport } from "@core/api/transport";

const client = createClient(BookmarksService, transport);

export const bookmarksApi = {
  toggleBookmark: (request: MessageInitShape<typeof ToggleBookmarkRequestSchema>) =>
    client.toggleBookmark(request),

  listBookmarkItems: (request: MessageInitShape<typeof ListBookmarkItemsRequestSchema>) =>
    client.listBookmarkItems(request),

  bulkCheckBookmarks: (request: MessageInitShape<typeof BulkCheckBookmarksRequestSchema>) =>
    client.bulkCheckBookmarks(request),
};
