/**
 * Sharing Redux Thunks
 *
 * Async actions for permission management.
 */

import { createAsyncThunk } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import { sharingApi } from '@/features/sharing/api/sharingApi';
import { ContentType, PermissionLevel, SubjectType } from '@uniffy/proto/common/v1/common_pb';
import {
    serializePermissionInfo,
    serializeShareTarget,
    type SerializedPermissionInfo,
    type SerializedShareTarget,
} from '@/features/sharing/store/sharingSlice';

/**
 * Fetch all permissions for a piece of content.
 */
export const fetchContentPermissions = createAsyncThunk<
    { permissions: SerializedPermissionInfo[]; owner: SerializedShareTarget | null },
    { contentType: number; contentId: string },
    { state: RootState }
>('sharing/fetchContentPermissions', async ({ contentType, contentId }, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    const response = await sharingApi.listContentPermissions({
        organizationId,
        contentType: contentType as ContentType,
        contentId,
    });

    return {
        permissions: response.permissions.map(serializePermissionInfo),
        owner: response.owner ? serializeShareTarget(response.owner) : null,
    };
});

/**
 * Grant permission to a user or group.
 */
export const grantPermission = createAsyncThunk<
    SerializedPermissionInfo,
    {
        contentType: number;
        contentId: string;
        subjectType: number;
        subjectId: string;
        level: number;
        expiresAt?: Date;
    },
    { state: RootState }
>(
    'sharing/grantPermission',
    async ({ contentType, contentId, subjectType, subjectId, level, expiresAt }, { getState }) => {
        const { auth } = getState();
        const organizationId = auth.currentOrganizationId;

        if (!organizationId) {
            throw new Error('No organization selected');
        }

        const response = await sharingApi.grantPermission({
            organizationId,
            contentType: contentType as ContentType,
            contentId,
            subjectType: subjectType as SubjectType,
            subjectId,
            level: level as PermissionLevel,
            expiresAt: expiresAt ? { seconds: BigInt(Math.floor(expiresAt.getTime() / 1000)), nanos: 0 } : undefined,
        });

        return serializePermissionInfo(response);
    }
);

/**
 * Revoke a permission.
 */
export const revokePermission = createAsyncThunk<
    void,
    { contentType: number; contentId: string; permissionId: string },
    { state: RootState }
>('sharing/revokePermission', async ({ permissionId }, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    await sharingApi.revokePermission({
        organizationId,
        permissionId,
    });
});

/**
 * Update an existing permission.
 */
export const updatePermission = createAsyncThunk<
    SerializedPermissionInfo,
    {
        permissionId: string;
        level?: number;
        expiresAt?: Date | null;
    },
    { state: RootState }
>('sharing/updatePermission', async ({ permissionId, level, expiresAt }, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    const response = await sharingApi.updatePermission({
        organizationId,
        permissionId,
        level: level !== undefined ? (level as PermissionLevel) : undefined,
        expiresAt: expiresAt ? { seconds: BigInt(Math.floor(expiresAt.getTime() / 1000)), nanos: 0 } : undefined,
        clearExpiration: expiresAt === null,
    });

    return serializePermissionInfo(response);
});

/**
 * Search for users and groups to share with.
 */
export const searchShareTargets = createAsyncThunk<
    SerializedShareTarget[],
    { query: string; includeUsers?: boolean; includeGroups?: boolean; limit?: number },
    { state: RootState }
>(
    'sharing/searchShareTargets',
    async ({ query, includeUsers = true, includeGroups = true, limit = 10 }, { getState }) => {
        const { auth } = getState();
        const organizationId = auth.currentOrganizationId;

        if (!organizationId) {
            throw new Error('No organization selected');
        }

        const response = await sharingApi.searchShareTargets({
            organizationId,
            query,
            includeUsers,
            includeGroups,
            limit,
        });

        return response.targets.map(serializeShareTarget);
    }
);
