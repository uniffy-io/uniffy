/**
 * Search API Service
 *
 * Centralized ConnectRPC client for unified search operations.
 */

import { createClient } from '@connectrpc/connect';
import { SearchService } from '@/gen/search/v1/search_connect';
import type { SearchRequest, ResolveUrnsRequest } from '@/gen/search/v1/search_pb';
import type { PartialMessage } from '@bufbuild/protobuf';
import type { Client } from '@connectrpc/connect';

// Lazy client initialization to avoid circular dependency with api.ts
let searchClient: Client<typeof SearchService> | null = null;

async function getSearchClient(): Promise<Client<typeof SearchService>> {
    if (!searchClient) {
        const { transport } = await import('@/config/api');
        searchClient = createClient(SearchService, transport);
    }
    return searchClient;
}

/**
 * Search API service with typed methods.
 */
export const searchApi = {
    /**
     * Perform a global fuzzy search across all entities.
     */
    search: async (request: PartialMessage<SearchRequest>) => {
        const client = await getSearchClient();
        return client.search(request);
    },

    /**
     * Resolve metadata for a batch of URNs.
     * Returns a map of URN -> metadata for accessible items.
     */
    resolveUrns: async (request: PartialMessage<ResolveUrnsRequest>) => {
        const client = await getSearchClient();
        return client.resolveUrns(request);
    },
};
