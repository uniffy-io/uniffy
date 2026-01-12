/**
 * Search API Service
 *
 * Centralized ConnectRPC client for unified search operations.
 */

import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { SearchService } from '@/gen/search/v1/search_connect';
import type { SearchRequest } from '@/gen/search/v1/search_pb';
import type { PartialMessage } from '@bufbuild/protobuf';

/**
 * Create a search service client with the shared transport.
 */
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
};
