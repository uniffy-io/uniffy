/**
 * Admin Redux Thunks
 *
 * Async actions for organization administration.
 */

import { createAsyncThunk } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import { adminApi } from '@/features/admin/api/adminApi';
import { storageApi } from '@/features/admin/api/storageApi';
import {
    ContentType,
    AccessMode,
    ContentRole,
    OrganizationRole,
    GroupRole,
    DomainType,
} from '@uniffy/proto/common/v1/common_pb';
import {
    serializeContentTypeDefaults,
    serializeMemberInfo,
    serializeGroupInfo,
    serializeGroupMemberInfo,
    serializeOrgOverview,
    type SerializedContentTypeDefaults,
    type SerializedMemberInfo,
    type SerializedGroupInfo,
    type SerializedGroupMemberInfo,
    type SerializedOrgOverview,
    serializeDomainAdminInfo,
    type SerializedDomainAdminInfo,
    type SerializedOrgStorageQuota,
    type SerializedUserQuotaOverride,
    type SerializedStorageUsageInfo,
} from '@/features/admin/store/adminSlice';

// Permission Defaults

export const fetchPermissionDefaults = createAsyncThunk<
    SerializedContentTypeDefaults[],
    void,
    { state: RootState }
>('admin/fetchPermissionDefaults', async (_, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    const response = await adminApi.getPermissionDefaults({ organizationId });
    return response.defaults.map(serializeContentTypeDefaults);
});

export const updatePermissionDefaults = createAsyncThunk<
    SerializedContentTypeDefaults,
    {
        contentType: number;
        defaultAccessMode?: number;
        defaultBaselineRole?: number | null;
    },
    { state: RootState }
>('admin/updatePermissionDefaults', async (args, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    const response = await adminApi.updatePermissionDefaults({
        organizationId,
        contentType: args.contentType as ContentType,
        defaultAccessMode: args.defaultAccessMode !== undefined
            ? args.defaultAccessMode as AccessMode
            : undefined,
        defaultBaselineRole: args.defaultBaselineRole !== undefined && args.defaultBaselineRole !== null
            ? args.defaultBaselineRole as ContentRole
            : undefined,
    });

    if (!response.defaults) throw new Error('defaults missing in UpdatePermissionDefaults response');
    return serializeContentTypeDefaults(response.defaults);
});

// Organization Overview

export const fetchOrganizationOverview = createAsyncThunk<
    SerializedOrgOverview,
    void,
    { state: RootState }
>('admin/fetchOrganizationOverview', async (_, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    const response = await adminApi.getOrganizationOverview({ organizationId });
    if (!response.overview) throw new Error('overview missing in GetOrganizationOverview response');
    return serializeOrgOverview(response.overview);
});

// Organization Settings

export interface SerializedOrgSettings {
    chat: {
        agentsEnabled: boolean;
    };
}

export const fetchOrganizationSettings = createAsyncThunk<
    SerializedOrgSettings,
    void,
    { state: RootState }
>('admin/fetchOrganizationSettings', async (_, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    const response = await adminApi.getOrganizationSettings({ organizationId });
    return {
        chat: {
            agentsEnabled: response.settings?.chat?.agentsEnabled ?? false,
        },
    };
});

export const updateOrganizationSettings = createAsyncThunk<
    SerializedOrgSettings,
    { chat?: { agentsEnabled: boolean } },
    { state: RootState }
>('admin/updateOrganizationSettings', async (args, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    const response = await adminApi.updateOrganizationSettings({
        organizationId,
        chat: args.chat,
    });
    return {
        chat: {
            agentsEnabled: response.settings?.chat?.agentsEnabled ?? false,
        },
    };
});

// Members

export const fetchMembers = createAsyncThunk<
    { members: SerializedMemberInfo[]; totalCount: number },
    { page?: number; pageSize?: number; roleFilter?: number; search?: string },
    { state: RootState }
>('admin/fetchMembers', async (args, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    const response = await adminApi.listMembers({
        organizationId,
        pagination: {
            page: args.page || 1,
            pageSize: args.pageSize || 50,
        },
        roleFilter: args.roleFilter !== undefined ? args.roleFilter as OrganizationRole : undefined,
        search: args.search,
    });

    return {
        members: response.members.map(serializeMemberInfo),
        totalCount: response.pagination?.totalCount || 0,
    };
});

export const updateMemberRole = createAsyncThunk<
    SerializedMemberInfo,
    { userId: string; role: number },
    { state: RootState }
>('admin/updateMemberRole', async ({ userId, role }, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    const response = await adminApi.updateMemberRole({
        organizationId,
        userId,
        role: role as OrganizationRole,
    });

    if (!response.member) throw new Error('member missing in UpdateMemberRole response');
    return serializeMemberInfo(response.member);
});

export const removeMember = createAsyncThunk<
    void,
    { userId: string },
    { state: RootState }
>('admin/removeMember', async ({ userId }, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    await adminApi.removeMember({ organizationId, userId });
});

// Groups

export const fetchGroups = createAsyncThunk<
    { groups: SerializedGroupInfo[]; totalCount: number },
    { page?: number; pageSize?: number },
    { state: RootState }
>('admin/fetchGroups', async (args, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    const response = await adminApi.listGroups({
        organizationId,
        pagination: {
            page: args.page || 1,
            pageSize: args.pageSize || 50,
        },
    });

    return {
        groups: response.groups.map(serializeGroupInfo),
        totalCount: response.pagination?.totalCount || 0,
    };
});

export const createGroup = createAsyncThunk<
    SerializedGroupInfo,
    { name: string; description?: string },
    { state: RootState }
>('admin/createGroup', async ({ name, description }, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    const response = await adminApi.createGroup({
        organizationId,
        name,
        description: description || '',
    });

    if (!response.group) throw new Error('group missing in CreateGroup response');
    return serializeGroupInfo(response.group);
});

export const updateGroup = createAsyncThunk<
    SerializedGroupInfo,
    { groupId: string; name?: string; description?: string },
    { state: RootState }
>('admin/updateGroup', async ({ groupId, name, description }, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    const response = await adminApi.updateGroup({
        organizationId,
        groupId,
        name,
        description,
    });

    if (!response.group) throw new Error('group missing in UpdateGroup response');
    return serializeGroupInfo(response.group);
});

export const deleteGroup = createAsyncThunk<
    void,
    { groupId: string },
    { state: RootState }
>('admin/deleteGroup', async ({ groupId }, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    await adminApi.deleteGroup({ organizationId, groupId });
});

// Group Members

export const fetchGroupMembers = createAsyncThunk<
    { members: SerializedGroupMemberInfo[]; totalCount: number },
    { groupId: string; page?: number; pageSize?: number },
    { state: RootState }
>('admin/fetchGroupMembers', async ({ groupId, page, pageSize }, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    const response = await adminApi.listGroupMembers({
        organizationId,
        groupId,
        pagination: {
            page: page || 1,
            pageSize: pageSize || 50,
        },
    });

    return {
        members: response.members.map(serializeGroupMemberInfo),
        totalCount: response.pagination?.totalCount || 0,
    };
});

export const addGroupMember = createAsyncThunk<
    SerializedGroupMemberInfo,
    { groupId: string; userId: string; role?: number },
    { state: RootState }
>('admin/addGroupMember', async ({ groupId, userId, role }, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    const response = await adminApi.addGroupMember({
        organizationId,
        groupId,
        userId,
        role: (role || GroupRole.MEMBER) as GroupRole,
    });

    if (!response.member) throw new Error('member missing in AddGroupMember response');
    return serializeGroupMemberInfo(response.member);
});

export const removeGroupMember = createAsyncThunk<
    void,
    { groupId: string; userId: string },
    { state: RootState }
>('admin/removeGroupMember', async ({ groupId, userId }, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    await adminApi.removeGroupMember({ organizationId, groupId, userId });
});

// Domain Admins

export const fetchDomainAdmins = createAsyncThunk<
    { domainAdmins: SerializedDomainAdminInfo[]; totalCount: number },
    { domainFilter?: number; page?: number; pageSize?: number },
    { state: RootState }
>('admin/fetchDomainAdmins', async (args, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    const response = await adminApi.listDomainAdmins({
        organizationId,
        domainFilter: args.domainFilter !== undefined ? args.domainFilter as DomainType : undefined,
        pagination: {
            page: args.page || 1,
            pageSize: args.pageSize || 50,
        },
    });

    return {
        domainAdmins: response.domainAdmins.map(serializeDomainAdminInfo),
        totalCount: response.pagination?.totalCount || 0,
    };
});

export const grantDomainAdmin = createAsyncThunk<
    SerializedDomainAdminInfo,
    { userId: string; domain: number },
    { state: RootState }
>('admin/grantDomainAdmin', async ({ userId, domain }, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    const response = await adminApi.grantDomainAdmin({
        organizationId,
        userId,
        domain: domain as DomainType,
    });

    if (!response.domainAdmin) throw new Error('domainAdmin missing in GrantDomainAdmin response');
    return serializeDomainAdminInfo(response.domainAdmin);
});

export const revokeDomainAdmin = createAsyncThunk<
    void,
    { userId: string; domain: number },
    { state: RootState }
>('admin/revokeDomainAdmin', async ({ userId, domain }, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    await adminApi.revokeDomainAdmin({
        organizationId,
        userId,
        domain: domain as DomainType,
    });
});

// Storage Quotas

export const fetchOrgStorageQuota = createAsyncThunk<
    { quota: SerializedOrgStorageQuota; totalUsedBytes: number; totalFileCount: number },
    void,
    { state: RootState }
>('admin/fetchOrgStorageQuota', async (_, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    const response = await storageApi.getOrgStorageQuota({ organizationId });
    const q = response.quota;

    return {
        quota: {
            id: q?.id || '',
            organizationId: q?.organizationId || '',
            orgQuotaBytes: q?.orgQuotaBytes != null ? Number(q.orgQuotaBytes) : null,
            defaultUserQuotaBytes: q?.defaultUserQuotaBytes != null ? Number(q.defaultUserQuotaBytes) : null,
            warnAtPercent: q?.warnAtPercent || 80,
            enforce: q?.enforce ?? true,
        },
        totalUsedBytes: Number(response.totalUsedBytes),
        totalFileCount: response.totalFileCount,
    };
});

export const setOrgStorageQuota = createAsyncThunk<
    SerializedOrgStorageQuota,
    {
        orgQuotaBytes?: number | null;
        defaultUserQuotaBytes?: number | null;
        warnAtPercent?: number;
        enforce?: boolean;
    },
    { state: RootState }
>('admin/setOrgStorageQuota', async (args, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    const request: Record<string, unknown> = { organizationId };
    if (args.orgQuotaBytes !== undefined) {
        request.orgQuotaBytes = args.orgQuotaBytes != null ? BigInt(args.orgQuotaBytes) : undefined;
    }
    if (args.defaultUserQuotaBytes !== undefined) {
        request.defaultUserQuotaBytes = args.defaultUserQuotaBytes != null
            ? BigInt(args.defaultUserQuotaBytes) : undefined;
    }
    if (args.warnAtPercent !== undefined) request.warnAtPercent = args.warnAtPercent;
    if (args.enforce !== undefined) request.enforce = args.enforce;

    const response = await storageApi.setOrgStorageQuota(request);
    const q = response.quota;

    return {
        id: q?.id || '',
        organizationId: q?.organizationId || '',
        orgQuotaBytes: q?.orgQuotaBytes != null ? Number(q.orgQuotaBytes) : null,
        defaultUserQuotaBytes: q?.defaultUserQuotaBytes != null ? Number(q.defaultUserQuotaBytes) : null,
        warnAtPercent: q?.warnAtPercent || 80,
        enforce: q?.enforce ?? true,
    };
});

export const fetchUserStorageQuotaOverrides = createAsyncThunk<
    SerializedUserQuotaOverride[],
    void,
    { state: RootState }
>('admin/fetchUserStorageQuotaOverrides', async (_, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    const response = await storageApi.listUserStorageQuotaOverrides({ organizationId });
    return response.overrides.map((o) => ({
        id: o.id,
        organizationId: o.organizationId,
        userId: o.userId,
        quotaBytes: Number(o.quotaBytes),
        note: o.note || null,
        createdBy: o.createdBy,
    }));
});

export const setUserStorageQuotaOverride = createAsyncThunk<
    SerializedUserQuotaOverride,
    { userId: string; quotaBytes: number; note?: string },
    { state: RootState }
>('admin/setUserStorageQuotaOverride', async ({ userId, quotaBytes, note }, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    const response = await storageApi.setUserStorageQuotaOverride({
        organizationId,
        userId,
        quotaBytes: BigInt(quotaBytes),
        note,
    });
    const o = response.override;
    return {
        id: o?.id || '',
        organizationId: o?.organizationId || '',
        userId: o?.userId || '',
        quotaBytes: Number(o?.quotaBytes),
        note: o?.note || null,
        createdBy: o?.createdBy || '',
    };
});

export const removeUserStorageQuotaOverride = createAsyncThunk<
    void,
    { userId: string },
    { state: RootState }
>('admin/removeUserStorageQuotaOverride', async ({ userId }, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    await storageApi.removeUserStorageQuotaOverride({ organizationId, userId });
});

export const fetchOrgStorageUsage = createAsyncThunk<
    { users: SerializedStorageUsageInfo[]; totalUsedBytes: number; totalFileCount: number },
    void,
    { state: RootState }
>('admin/fetchOrgStorageUsage', async (_, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    const response = await storageApi.listOrgStorageUsage({ organizationId });
    return {
        users: response.users.map((u) => ({
            userId: u.userId,
            organizationId: u.organizationId,
            usedBytes: Number(u.usedBytes),
            fileCount: u.fileCount,
            effectiveQuotaBytes: u.effectiveQuotaBytes != null ? Number(u.effectiveQuotaBytes) : null,
            usagePercent: u.usagePercent,
            hasOverride: u.hasOverride,
        })),
        totalUsedBytes: Number(response.totalUsedBytes),
        totalFileCount: response.totalFileCount,
    };
});

export const recalculateStorageUsage = createAsyncThunk<
    SerializedStorageUsageInfo[],
    { userId?: string },
    { state: RootState }
>('admin/recalculateStorageUsage', async (args, { getState }) => {
    const { auth } = getState();
    const organizationId = auth.currentOrganizationId;

    if (!organizationId) {
        throw new Error('No organization selected');
    }

    const response = await storageApi.recalculateStorageUsage({
        organizationId,
        userId: args.userId,
    });

    return response.recalculated.map((u) => ({
        userId: u.userId,
        organizationId: u.organizationId,
        usedBytes: Number(u.usedBytes),
        fileCount: u.fileCount,
        effectiveQuotaBytes: u.effectiveQuotaBytes != null ? Number(u.effectiveQuotaBytes) : null,
        usagePercent: u.usagePercent,
        hasOverride: u.hasOverride,
    }));
});
