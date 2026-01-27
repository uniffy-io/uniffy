import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { BookmarksService } from '@/gen/bookmarks/v1/bookmarks_connect';
import type {
    ToggleBookmarkRequest,
    ListBookmarksRequest,
    BulkCheckBookmarksRequest,
} from '@/gen/bookmarks/v1/bookmarks_pb';
import type { PartialMessage } from '@bufbuild/protobuf';

/**
 * Create a bookmarks service client with the shared transport.
 */
const bookmarksClient = createClient(BookmarksService, transport);

/**
 * Bookmarks API service with typed methods.
 */
export const bookmarksApi = {
    /**
     * Toggle bookmark on a URN (add if not bookmarked, remove if bookmarked).
     */
    toggleBookmark: async (request: PartialMessage<ToggleBookmarkRequest>) => {
        return bookmarksClient.toggleBookmark(request);
    },

    /**
     * List all bookmarks for the current user in an organization.
     */
    listBookmarks: async (request: PartialMessage<ListBookmarksRequest>) => {
        return bookmarksClient.listBookmarks(request);
    },

    /**
     * Check multiple URNs for bookmark status.
     */
    bulkCheckBookmarks: async (request: PartialMessage<BulkCheckBookmarksRequest>) => {
        return bookmarksClient.bulkCheckBookmarks(request);
    },
};
