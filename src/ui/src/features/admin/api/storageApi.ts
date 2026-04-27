/**
 * Storage Quota API Service
 *
 * ConnectRPC client wrapper for storage quota management RPCs.
 */

import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { FilesService } from '@uniffy/proto/files/v1/files_connect';
import type {
    GetOrgStorageQuotaRequest,
    SetOrgStorageQuotaRequest,
    GetUserStorageQuotaRequest,
    SetUserStorageQuotaOverrideRequest,
    RemoveUserStorageQuotaOverrideRequest,
    ListUserStorageQuotaOverridesRequest,
    GetStorageUsageRequest,
    ListOrgStorageUsageRequest,
    RecalculateStorageUsageRequest,
    CheckStorageQuotaRequest,
} from '@uniffy/proto/files/v1/files_pb';
import type { PartialMessage } from '@bufbuild/protobuf';

const filesClient = createClient(FilesService, transport);

/**
 * Storage quota API methods.
 */
export const storageApi = {
    getOrgStorageQuota: async (request: PartialMessage<GetOrgStorageQuotaRequest>) => {
        return filesClient.getOrgStorageQuota(request);
    },

    setOrgStorageQuota: async (request: PartialMessage<SetOrgStorageQuotaRequest>) => {
        return filesClient.setOrgStorageQuota(request);
    },

    getUserStorageQuota: async (request: PartialMessage<GetUserStorageQuotaRequest>) => {
        return filesClient.getUserStorageQuota(request);
    },

    setUserStorageQuotaOverride: async (request: PartialMessage<SetUserStorageQuotaOverrideRequest>) => {
        return filesClient.setUserStorageQuotaOverride(request);
    },

    removeUserStorageQuotaOverride: async (request: PartialMessage<RemoveUserStorageQuotaOverrideRequest>) => {
        return filesClient.removeUserStorageQuotaOverride(request);
    },

    listUserStorageQuotaOverrides: async (request: PartialMessage<ListUserStorageQuotaOverridesRequest>) => {
        return filesClient.listUserStorageQuotaOverrides(request);
    },

    getStorageUsage: async (request: PartialMessage<GetStorageUsageRequest>) => {
        return filesClient.getStorageUsage(request);
    },

    listOrgStorageUsage: async (request: PartialMessage<ListOrgStorageUsageRequest>) => {
        return filesClient.listOrgStorageUsage(request);
    },

    recalculateStorageUsage: async (request: PartialMessage<RecalculateStorageUsageRequest>) => {
        return filesClient.recalculateStorageUsage(request);
    },

    checkStorageQuota: async (request: PartialMessage<CheckStorageQuotaRequest>) => {
        return filesClient.checkStorageQuota(request);
    },
};
