/**
 * Sharing API Service
 *
 * Centralized ConnectRPC client for permission management operations.
 * Handles granting, revoking, and listing permissions on content.
 */

import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { PermissionsService } from '@/gen/permissions/v1/permissions_connect';
import type {
    GrantPermissionRequest,
    RevokePermissionRequest,
    UpdatePermissionRequest,
    ListContentPermissionsRequest,
    GetMyPermissionRequest,
    SearchShareTargetsRequest,
} from '@/gen/permissions/v1/permissions_pb';
import type { PartialMessage } from '@bufbuild/protobuf';

/**
 * Create a permissions service client with the shared transport.
 */
const permissionsClient = createClient(PermissionsService, transport);

/**
 * Sharing API service with typed methods.
 */
export const sharingApi = {
    /**
     * Grant permission to a user or group on content.
     */
    grantPermission: async (request: PartialMessage<GrantPermissionRequest>) => {
        return permissionsClient.grantPermission(request);
    },

    /**
     * Revoke permission from a user or group on content.
     */
    revokePermission: async (request: PartialMessage<RevokePermissionRequest>) => {
        return permissionsClient.revokePermission(request);
    },

    /**
     * Update an existing permission.
     */
    updatePermission: async (request: PartialMessage<UpdatePermissionRequest>) => {
        return permissionsClient.updatePermission(request);
    },

    /**
     * List all permissions for a piece of content.
     */
    listContentPermissions: async (request: PartialMessage<ListContentPermissionsRequest>) => {
        return permissionsClient.listContentPermissions(request);
    },

    /**
     * Get the current user's permission on content.
     */
    getMyPermission: async (request: PartialMessage<GetMyPermissionRequest>) => {
        return permissionsClient.getMyPermission(request);
    },

    /**
     * Search for users and groups to share with.
     */
    searchShareTargets: async (request: PartialMessage<SearchShareTargetsRequest>) => {
        return permissionsClient.searchShareTargets(request);
    },
};

export default sharingApi;
