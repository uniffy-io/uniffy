import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  BookmarksService,
  BulkCheckBookmarksRequestSchema,
  ListBookmarksRequestSchema,
  ToggleBookmarkRequestSchema,
} from "@uniffy/proto/bookmarks/v1/bookmarks_pb";
import { transport } from "@/lib/transport";

const client = createClient(BookmarksService, transport);

export const bookmarksApi = {
  toggleBookmark: (request: MessageInitShape<typeof ToggleBookmarkRequestSchema>) =>
    client.toggleBookmark(request),

  listBookmarks: (request: MessageInitShape<typeof ListBookmarksRequestSchema>) =>
    client.listBookmarks(request),

  bulkCheckBookmarks: (request: MessageInitShape<typeof BulkCheckBookmarksRequestSchema>) =>
    client.bulkCheckBookmarks(request),
};
