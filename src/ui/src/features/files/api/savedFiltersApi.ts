/**
 * Saved File Filters API Service
 *
 * ConnectRPC client for saved file filter operations.
 */

import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { FilesService } from '@uniffy/proto/files/v1/files_connect';
import type {
    CreateSavedFilterRequest,
    GetSavedFilterRequest,
    UpdateSavedFilterRequest,
    DeleteSavedFilterRequest,
    ListSavedFiltersRequest,
} from '@uniffy/proto/files/v1/files_pb';
import type { PartialMessage } from '@bufbuild/protobuf';

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
    createSavedFilter: async (request: PartialMessage<CreateSavedFilterRequest>) => {
        return filesClient.createSavedFilter(request);
    },

    /**
     * Get a saved filter by ID.
     */
    getSavedFilter: async (request: PartialMessage<GetSavedFilterRequest>) => {
        return filesClient.getSavedFilter(request);
    },

    /**
     * Update a saved filter.
     */
    updateSavedFilter: async (request: PartialMessage<UpdateSavedFilterRequest>) => {
        return filesClient.updateSavedFilter(request);
    },

    /**
     * Delete a saved filter.
     */
    deleteSavedFilter: async (request: PartialMessage<DeleteSavedFilterRequest>) => {
        return filesClient.deleteSavedFilter(request);
    },

    /**
     * List saved filters for the current user.
     */
    listSavedFilters: async (request: PartialMessage<ListSavedFiltersRequest>) => {
        return filesClient.listSavedFilters(request);
    },
};
