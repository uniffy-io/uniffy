/**
 * Admin Redux Thunks
 *
 * Async actions for organization administration.
 */

import { createAsyncThunk } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import { adminApi } from '@/features/admin/api/adminApi';
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

    return serializeContentTypeDefaults(response);
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
    return serializeOrgOverview(response);
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

    return serializeMemberInfo(response);
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

    return serializeGroupInfo(response);
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

    return serializeGroupInfo(response);
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

    return serializeGroupMemberInfo(response);
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

    return serializeDomainAdminInfo(response);
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
