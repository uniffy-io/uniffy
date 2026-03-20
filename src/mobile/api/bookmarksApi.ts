import { createClient } from "@connectrpc/connect";
import type { PartialMessage } from "@bufbuild/protobuf";
import { BookmarksService } from "@uniffy/proto/bookmarks/v1/bookmarks_connect";
import type {
  ToggleBookmarkRequest,
  ListBookmarksRequest,
  BulkCheckBookmarksRequest,
} from "@uniffy/proto/bookmarks/v1/bookmarks_pb";
import { transport } from "@/lib/transport";

const client = createClient(BookmarksService, transport);

export const bookmarksApi = {
  toggleBookmark: (request: PartialMessage<ToggleBookmarkRequest>) =>
    client.toggleBookmark(request),

  listBookmarks: (request: PartialMessage<ListBookmarksRequest>) => client.listBookmarks(request),

  bulkCheckBookmarks: (request: PartialMessage<BulkCheckBookmarksRequest>) =>
    client.bulkCheckBookmarks(request),
};
