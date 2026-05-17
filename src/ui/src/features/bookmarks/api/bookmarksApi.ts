import { createClient } from '@connectrpc/connect';
import { unaryTransport } from '@/config/api';
import { BookmarksService, BulkCheckBookmarksRequestSchema, ListBookmarksRequestSchema, ToggleBookmarkRequestSchema } from '@uniffy/proto/bookmarks/v1/bookmarks_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

/**
 * Create a bookmarks service client with the shared transport.
 */
const bookmarksClient = createClient(BookmarksService, unaryTransport);

/**
 * Bookmarks API service with typed methods.
 */
export const bookmarksApi = {
    /**
     * Toggle bookmark on a URN (add if not bookmarked, remove if bookmarked).
     */
    toggleBookmark: async (request: MessageInitShape<typeof ToggleBookmarkRequestSchema>) => {
        return bookmarksClient.toggleBookmark(request);
    },

    /**
     * List all bookmarks for the current user in an organization.
     */
    listBookmarks: async (request: MessageInitShape<typeof ListBookmarksRequestSchema>) => {
        return bookmarksClient.listBookmarks(request);
    },

    /**
     * Check multiple URNs for bookmark status.
     */
    bulkCheckBookmarks: async (request: MessageInitShape<typeof BulkCheckBookmarksRequestSchema>) => {
        return bookmarksClient.bulkCheckBookmarks(request);
    },
};
