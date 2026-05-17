/**
 * Saved File Filters API Service
 *
 * ConnectRPC client for saved file filter operations.
 */

import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { FilesService, CreateSavedFilterRequestSchema, DeleteSavedFilterRequestSchema, GetSavedFilterRequestSchema, ListSavedFiltersRequestSchema, UpdateSavedFilterRequestSchema } from '@uniffy/proto/files/v1/files_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

/**
 * Create a files service client with the shared transport.
 */
const filesClient = createClient(FilesService, transport);

/**
 * Saved filters API service with typed methods.
 */
export const savedFiltersApi = {
    /**
     * Create a new saved filter.
     */
    createSavedFilter: async (request: MessageInitShape<typeof CreateSavedFilterRequestSchema>) => {
        return filesClient.createSavedFilter(request);
    },

    /**
     * Get a saved filter by ID.
     */
    getSavedFilter: async (request: MessageInitShape<typeof GetSavedFilterRequestSchema>) => {
        return filesClient.getSavedFilter(request);
    },

    /**
     * Update a saved filter.
     */
    updateSavedFilter: async (request: MessageInitShape<typeof UpdateSavedFilterRequestSchema>) => {
        return filesClient.updateSavedFilter(request);
    },

    /**
     * Delete a saved filter.
     */
    deleteSavedFilter: async (request: MessageInitShape<typeof DeleteSavedFilterRequestSchema>) => {
        return filesClient.deleteSavedFilter(request);
    },

    /**
     * List saved filters for the current user.
     */
    listSavedFilters: async (request: MessageInitShape<typeof ListSavedFiltersRequestSchema>) => {
        return filesClient.listSavedFilters(request);
    },
};
