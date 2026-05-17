/**
 * Search API Service
 *
 * Centralized ConnectRPC client for unified search operations.
 */

import { createClient } from '@connectrpc/connect';
import { SearchService, ResolveUrnsRequestSchema, SearchRequestSchema } from '@uniffy/proto/search/v1/search_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';
import { unaryTransport } from '@/config/api';

// Create search client using static import (no circular dependency)
const searchClient = createClient(SearchService, unaryTransport);

/**
 * Search API service with typed methods.
 */
export const searchApi = {
    /**
     * Perform a global fuzzy search across all entities.
     */
    search: async (request: MessageInitShape<typeof SearchRequestSchema>) => {
        return searchClient.search(request);
    },

    /**
     * Resolve metadata for a batch of URNs.
     * Returns a map of URN -> metadata for accessible items.
     */
    resolveUrns: async (request: MessageInitShape<typeof ResolveUrnsRequestSchema>) => {
        return searchClient.resolveUrns(request);
    },
};
