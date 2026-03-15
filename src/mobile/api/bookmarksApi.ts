import { createClient } from "@connectrpc/connect";
import type { PartialMessage } from "@bufbuild/protobuf";
import { BookmarksService } from "@/gen/bookmarks/v1/bookmarks_connect";
import type {
  ToggleBookmarkRequest,
  ListBookmarksRequest,
  BulkCheckBookmarksRequest,
} from "@/gen/bookmarks/v1/bookmarks_pb";
import { transport } from "@/lib/transport";

const client = createClient(BookmarksService, transport);

export const bookmarksApi = {
  toggleBookmark: (request: PartialMessage<ToggleBookmarkRequest>) =>
    client.toggleBookmark(request),

  listBookmarks: (request: PartialMessage<ListBookmarksRequest>) => client.listBookmarks(request),

  bulkCheckBookmarks: (request: PartialMessage<BulkCheckBookmarksRequest>) =>
    client.bulkCheckBookmarks(request),
};
