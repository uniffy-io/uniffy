/**
 * Storage Quota API Service
 *
 * ConnectRPC client wrapper for storage quota management RPCs.
 */

import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { FilesService, CheckStorageQuotaRequestSchema, GetOrgStorageQuotaRequestSchema, GetStorageUsageRequestSchema, GetUserStorageQuotaRequestSchema, ListOrgStorageUsageRequestSchema, ListUserStorageQuotaOverridesRequestSchema, RecalculateStorageUsageRequestSchema, RemoveUserStorageQuotaOverrideRequestSchema, SetOrgStorageQuotaRequestSchema, SetUserStorageQuotaOverrideRequestSchema } from '@uniffy/proto/files/v1/files_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

const filesClient = createClient(FilesService, transport);

/**
 * Storage quota API methods.
 */
export const storageApi = {
    getOrgStorageQuota: async (request: MessageInitShape<typeof GetOrgStorageQuotaRequestSchema>) => {
        return filesClient.getOrgStorageQuota(request);
    },

    setOrgStorageQuota: async (request: MessageInitShape<typeof SetOrgStorageQuotaRequestSchema>) => {
        return filesClient.setOrgStorageQuota(request);
    },

    getUserStorageQuota: async (request: MessageInitShape<typeof GetUserStorageQuotaRequestSchema>) => {
        return filesClient.getUserStorageQuota(request);
    },

    setUserStorageQuotaOverride: async (request: MessageInitShape<typeof SetUserStorageQuotaOverrideRequestSchema>) => {
        return filesClient.setUserStorageQuotaOverride(request);
    },

    removeUserStorageQuotaOverride: async (request: MessageInitShape<typeof RemoveUserStorageQuotaOverrideRequestSchema>) => {
        return filesClient.removeUserStorageQuotaOverride(request);
    },

    listUserStorageQuotaOverrides: async (request: MessageInitShape<typeof ListUserStorageQuotaOverridesRequestSchema>) => {
        return filesClient.listUserStorageQuotaOverrides(request);
    },

    getStorageUsage: async (request: MessageInitShape<typeof GetStorageUsageRequestSchema>) => {
        return filesClient.getStorageUsage(request);
    },

    listOrgStorageUsage: async (request: MessageInitShape<typeof ListOrgStorageUsageRequestSchema>) => {
        return filesClient.listOrgStorageUsage(request);
    },

    recalculateStorageUsage: async (request: MessageInitShape<typeof RecalculateStorageUsageRequestSchema>) => {
        return filesClient.recalculateStorageUsage(request);
    },

    checkStorageQuota: async (request: MessageInitShape<typeof CheckStorageQuotaRequestSchema>) => {
        return filesClient.checkStorageQuota(request);
    },
};
