/**
 * Search API Service
 *
 * Centralized ConnectRPC client for unified search operations.
 */

import { createClient } from '@connectrpc/connect';
import { SearchService } from '@/gen/search/v1/search_connect';
import type { SearchRequest, ResolveUrnsRequest } from '@/gen/search/v1/search_pb';
import type { PartialMessage } from '@bufbuild/protobuf';
import { transport } from '@/config/api';

// Create search client using static import (no circular dependency)
const searchClient = createClient(SearchService, transport);

/**
 * Search API service with typed methods.
 */
export const searchApi = {
    /**
     * Perform a global fuzzy search across all entities.
     */
    search: async (request: PartialMessage<SearchRequest>) => {
        return searchClient.search(request);
    },

    /**
     * Resolve metadata for a batch of URNs.
     * Returns a map of URN -> metadata for accessible items.
     */
    resolveUrns: async (request: PartialMessage<ResolveUrnsRequest>) => {
        return searchClient.resolveUrns(request);
    },
};
