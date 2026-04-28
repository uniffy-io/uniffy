/**
 * Admin Redux Slice
 *
 * Manages state for organization administration (permission defaults, groups, members).
 */

import { createSlice } from '@reduxjs/toolkit';
import type {
    ContentTypeDefaults,
    OrganizationOverview,
} from '@uniffy/proto/organizations/v1/organizations_pb';
import type {
    MemberInfo,
    GroupInfo,
    GroupMemberInfo,
    DomainAdminInfo,
} from '@uniffy/proto/common/v1/common_pb';
import {
    fetchPermissionDefaults,
    updatePermissionDefaults,
    fetchOrganizationOverview,
    fetchMembers,
    updateMemberRole,
    removeMember,
    fetchGroups,
    createGroup,
    updateGroup,
    deleteGroup,
    fetchGroupMembers,
    addGroupMember,
    removeGroupMember,
    fetchDomainAdmins,
    grantDomainAdmin,
    revokeDomainAdmin,
    fetchOrgStorageQuota,
    setOrgStorageQuota,
    fetchOrgStorageUsage,
    fetchUserStorageQuotaOverrides,
    setUserStorageQuotaOverride,
    removeUserStorageQuotaOverride,
    recalculateStorageUsage,
    fetchOrganizationSettings,
    updateOrganizationSettings,
    type SerializedOrgSettings,
} from '@/features/admin/store/adminThunks';

/**
 * Serialized content type defaults.
 */
export interface SerializedContentTypeDefaults {
    contentType: number;
    defaultAccessMode: number;
    defaultBaselineRole: number | null;
    updatedAt: { seconds: string; nanos: number } | null;
}

/**
 * Serialized member info.
 */
export interface SerializedMemberInfo {
    userId: string;
    displayName: string;
    email: string;
    avatarUrl: string;
    hasAvatar: boolean;
    role: number;
    joinedAt: { seconds: number; nanos: number } | null;
    isActive: boolean;
}

/**
 * Serialized group info.
 */
export interface SerializedGroupInfo {
    id: string;
    name: string;
    slug: string;
    description: string;
    memberCount: number;
    organizationId: string;
    isPrivate: boolean;
    isDefault: boolean;
    createdAt: { seconds: number; nanos: number } | null;
    updatedAt: { seconds: number; nanos: number } | null;
}

/**
 * Serialized group member info.
 */
export interface SerializedGroupMemberInfo {
    userId: string;
    displayName: string;
    email: string;
    avatarUrl: string;
    role: number;
    joinedAt: { seconds: number; nanos: number } | null;
}

/**
 * Serialized organization overview.
 */
export interface SerializedOrgOverview {
    organizationId: string;
    name: string;
    memberCount: number;
    groupCount: number;
    contentCounts: Record<string, number>;
    createdAt: { seconds: number; nanos: number } | null;
}

// Serialization functions - convert bigint timestamps to numbers for Redux
export function serializeContentTypeDefaults(d: ContentTypeDefaults): SerializedContentTypeDefaults {
    return {
        contentType: d.contentType,
        defaultAccessMode: d.defaultAccessMode,
        defaultBaselineRole: d.defaultBaselineRole ?? null,
        updatedAt: d.updatedAt ? { seconds: String(d.updatedAt.seconds), nanos: d.updatedAt.nanos } : null,
    };
}

export function serializeMemberInfo(m: MemberInfo): SerializedMemberInfo {
    return {
        userId: m.userId,
        displayName: m.displayName,
        email: m.email,
        avatarUrl: m.avatarUrl || '',
        hasAvatar: m.hasAvatar,
        role: m.role,
        joinedAt: m.joinedAt ? { seconds: Number(m.joinedAt.seconds), nanos: m.joinedAt.nanos } : null,
        isActive: m.isActive,
    };
}

export function serializeGroupInfo(g: GroupInfo): SerializedGroupInfo {
    return {
        id: g.id,
        name: g.name,
        slug: g.slug,
        description: g.description || '',
        memberCount: g.memberCount,
        organizationId: g.organizationId,
        isPrivate: g.isPrivate,
        isDefault: g.isDefault,
        createdAt: g.createdAt ? { seconds: Number(g.createdAt.seconds), nanos: g.createdAt.nanos } : null,
        updatedAt: g.updatedAt ? { seconds: Number(g.updatedAt.seconds), nanos: g.updatedAt.nanos } : null,
    };
}

export function serializeGroupMemberInfo(m: GroupMemberInfo): SerializedGroupMemberInfo {
    return {
        userId: m.userId,
        displayName: m.displayName,
        email: m.email,
        avatarUrl: m.avatarUrl || '',
        role: m.role,
        joinedAt: m.joinedAt ? { seconds: Number(m.joinedAt.seconds), nanos: m.joinedAt.nanos } : null,
    };
}

/**
 * Serialized domain admin info.
 */
export interface SerializedDomainAdminInfo {
    id: string;
    userId: string;
    displayName: string;
    email: string;
    avatarUrl: string;
    domain: number;
    grantedByUserId: string;
    grantedAt: { seconds: number; nanos: number } | null;
}

export function serializeDomainAdminInfo(d: DomainAdminInfo): SerializedDomainAdminInfo {
    return {
        id: d.id,
        userId: d.userId,
        displayName: d.displayName,
        email: d.email,
        avatarUrl: d.avatarUrl || '',
        domain: d.domain,
        grantedByUserId: d.grantedByUserId,
        grantedAt: d.grantedAt ? { seconds: Number(d.grantedAt.seconds), nanos: d.grantedAt.nanos } : null,
    };
}

export function serializeOrgOverview(o: OrganizationOverview): SerializedOrgOverview {
    const contentCounts: Record<string, number> = {};
    // Convert array of ContentTypeCount to Record<string, number>
    for (const item of o.contentCounts) {
        contentCounts[String(item.contentType)] = item.count;
    }
    return {
        organizationId: o.organization?.id || '',
        name: o.organization?.name || '',
        memberCount: o.memberCount,
        groupCount: o.groupCount,
        contentCounts,
        createdAt: o.organization?.createdAt ? { seconds: Number(o.organization.createdAt.seconds), nanos: o.organization.createdAt.nanos } : null,
    };
}

/**
 * Serialized org storage quota.
 */
export interface SerializedOrgStorageQuota {
    id: string;
    organizationId: string;
    orgQuotaBytes: number | null;
    defaultUserQuotaBytes: number | null;
    warnAtPercent: number;
    enforce: boolean;
}

/**
 * Serialized user storage quota override.
 */
export interface SerializedUserQuotaOverride {
    id: string;
    organizationId: string;
    userId: string;
    quotaBytes: number;
    note: string | null;
    createdBy: string;
}

/**
 * Serialized storage usage for a user.
 */
export interface SerializedStorageUsageInfo {
    userId: string;
    organizationId: string;
    usedBytes: number;
    fileCount: number;
    effectiveQuotaBytes: number | null;
    usagePercent: number;
    hasOverride: boolean;
}

export interface AdminState {
    // Permission defaults
    permissionDefaults: SerializedContentTypeDefaults[];
    permissionDefaultsLoading: boolean;
    permissionDefaultsError: string | null;

    // Organization overview
    overview: SerializedOrgOverview | null;
    overviewLoading: boolean;

    // Members
    members: SerializedMemberInfo[];
    membersLoading: boolean;
    membersFetched: boolean;
    membersTotalCount: number;

    // Groups
    groups: SerializedGroupInfo[];
    groupsLoading: boolean;
    groupsFetched: boolean;
    groupsTotalCount: number;

    // Group members (keyed by group ID)
    groupMembers: Record<string, SerializedGroupMemberInfo[]>;
    groupMembersLoading: Record<string, boolean>;

    // Domain admins
    domainAdmins: SerializedDomainAdminInfo[];
    domainAdminsLoading: boolean;
    domainAdminsFetched: boolean;
    domainAdminsTotalCount: number;

    // Storage quotas
    orgQuota: SerializedOrgStorageQuota | null;
    orgQuotaLoading: boolean;
    orgTotalUsedBytes: number;
    orgTotalFileCount: number;
    userOverrides: SerializedUserQuotaOverride[];
    userOverridesLoading: boolean;
    userUsageList: SerializedStorageUsageInfo[];
    userUsageListLoading: boolean;

    // Organization settings (JSONB blob)
    orgSettings: SerializedOrgSettings | null;
    orgSettingsLoading: boolean;
    orgSettingsSaving: boolean;

    // General error
    error: string | null;
}

const initialState: AdminState = {
    permissionDefaults: [],
    permissionDefaultsLoading: false,
    permissionDefaultsError: null,
    overview: null,
    overviewLoading: false,
    members: [],
    membersLoading: false,
    membersFetched: false,
    membersTotalCount: 0,
    groups: [],
    groupsLoading: false,
    groupsFetched: false,
    groupsTotalCount: 0,
    groupMembers: {},
    groupMembersLoading: {},
    domainAdmins: [],
    domainAdminsLoading: false,
    domainAdminsFetched: false,
    domainAdminsTotalCount: 0,
    orgQuota: null,
    orgQuotaLoading: false,
    orgTotalUsedBytes: 0,
    orgTotalFileCount: 0,
    userOverrides: [],
    userOverridesLoading: false,
    userUsageList: [],
    userUsageListLoading: false,
    orgSettings: null,
    orgSettingsLoading: false,
    orgSettingsSaving: false,
    error: null,
};

const adminSlice = createSlice({
    name: 'admin',
    initialState,
    reducers: {
        clearAdminError: (state) => {
            state.error = null;
            state.permissionDefaultsError = null;
        },
        clearAdmin: () => initialState,
    },
    extraReducers: (builder) => {
        // Permission defaults
        builder.addCase(fetchPermissionDefaults.pending, (state) => {
            state.permissionDefaultsLoading = true;
            state.permissionDefaultsError = null;
        });
        builder.addCase(fetchPermissionDefaults.fulfilled, (state, action) => {
            state.permissionDefaultsLoading = false;
            state.permissionDefaults = action.payload;
        });
        builder.addCase(fetchPermissionDefaults.rejected, (state, action) => {
            state.permissionDefaultsLoading = false;
            state.permissionDefaultsError = action.error.message || 'Failed to fetch defaults';
        });

        builder.addCase(updatePermissionDefaults.fulfilled, (state, action) => {
            const index = state.permissionDefaults.findIndex(
                (d) => d.contentType === action.payload.contentType
            );
            if (index !== -1) {
                state.permissionDefaults[index] = action.payload;
            } else {
                state.permissionDefaults.push(action.payload);
            }
        });

        // Overview
        builder.addCase(fetchOrganizationOverview.pending, (state) => {
            state.overviewLoading = true;
        });
        builder.addCase(fetchOrganizationOverview.fulfilled, (state, action) => {
            state.overviewLoading = false;
            state.overview = action.payload;
        });
        builder.addCase(fetchOrganizationOverview.rejected, (state) => {
            state.overviewLoading = false;
        });

        // Members
        builder.addCase(fetchMembers.pending, (state) => {
            state.membersLoading = true;
        });
        builder.addCase(fetchMembers.fulfilled, (state, action) => {
            state.membersLoading = false;
            state.membersFetched = true;
            state.members = action.payload.members;
            state.membersTotalCount = action.payload.totalCount;
        });
        builder.addCase(fetchMembers.rejected, (state, action) => {
            state.membersLoading = false;
            state.membersFetched = true;
            state.error = action.error.message || 'Failed to fetch members';
        });

        builder.addCase(updateMemberRole.fulfilled, (state, action) => {
            const index = state.members.findIndex((m) => m.userId === action.payload.userId);
            if (index !== -1) {
                state.members[index] = action.payload;
            }
        });

        builder.addCase(removeMember.fulfilled, (state, action) => {
            state.members = state.members.filter((m) => m.userId !== action.meta.arg.userId);
            state.membersTotalCount -= 1;
        });

        // Groups
        builder.addCase(fetchGroups.pending, (state) => {
            state.groupsLoading = true;
        });
        builder.addCase(fetchGroups.fulfilled, (state, action) => {
            state.groupsLoading = false;
            state.groupsFetched = true;
            state.groups = action.payload.groups;
            state.groupsTotalCount = action.payload.totalCount;
        });
        builder.addCase(fetchGroups.rejected, (state, action) => {
            state.groupsLoading = false;
            state.groupsFetched = true;
            state.error = action.error.message || 'Failed to fetch groups';
        });

        builder.addCase(createGroup.fulfilled, (state, action) => {
            state.groups.push(action.payload);
            state.groupsTotalCount += 1;
        });

        builder.addCase(updateGroup.fulfilled, (state, action) => {
            const index = state.groups.findIndex((g) => g.id === action.payload.id);
            if (index !== -1) {
                state.groups[index] = action.payload;
            }
        });

        builder.addCase(deleteGroup.fulfilled, (state, action) => {
            state.groups = state.groups.filter((g) => g.id !== action.meta.arg.groupId);
            state.groupsTotalCount -= 1;
        });

        // Group members
        builder.addCase(fetchGroupMembers.pending, (state, action) => {
            state.groupMembersLoading[action.meta.arg.groupId] = true;
        });
        builder.addCase(fetchGroupMembers.fulfilled, (state, action) => {
            const { groupId } = action.meta.arg;
            state.groupMembersLoading[groupId] = false;
            state.groupMembers[groupId] = action.payload.members;
        });
        builder.addCase(fetchGroupMembers.rejected, (state, action) => {
            state.groupMembersLoading[action.meta.arg.groupId] = false;
        });

        builder.addCase(addGroupMember.fulfilled, (state, action) => {
            const { groupId } = action.meta.arg;
            const members = state.groupMembers[groupId] || [];
            state.groupMembers[groupId] = [...members, action.payload];
            // Update group member count
            const group = state.groups.find((g) => g.id === groupId);
            if (group) {
                group.memberCount += 1;
            }
        });

        builder.addCase(removeGroupMember.fulfilled, (state, action) => {
            const { groupId, userId } = action.meta.arg;
            const members = state.groupMembers[groupId] || [];
            state.groupMembers[groupId] = members.filter((m) => m.userId !== userId);
            // Update group member count
            const group = state.groups.find((g) => g.id === groupId);
            if (group && group.memberCount > 0) {
                group.memberCount -= 1;
            }
        });

        // Domain admins
        builder.addCase(fetchDomainAdmins.pending, (state) => {
            state.domainAdminsLoading = true;
        });
        builder.addCase(fetchDomainAdmins.fulfilled, (state, action) => {
            state.domainAdminsLoading = false;
            state.domainAdminsFetched = true;
            state.domainAdmins = action.payload.domainAdmins;
            state.domainAdminsTotalCount = action.payload.totalCount;
        });
        builder.addCase(fetchDomainAdmins.rejected, (state, action) => {
            state.domainAdminsLoading = false;
            state.domainAdminsFetched = true;
            state.error = action.error.message || 'Failed to fetch domain admins';
        });

        builder.addCase(grantDomainAdmin.fulfilled, (state, action) => {
            state.domainAdmins.push(action.payload);
            state.domainAdminsTotalCount += 1;
        });

        builder.addCase(revokeDomainAdmin.fulfilled, (state, action) => {
            const { userId, domain } = action.meta.arg;
            state.domainAdmins = state.domainAdmins.filter(
                (da) => !(da.userId === userId && da.domain === domain)
            );
            state.domainAdminsTotalCount = Math.max(0, state.domainAdminsTotalCount - 1);
        });

        // Storage: org quota
        builder.addCase(fetchOrgStorageQuota.pending, (state) => {
            state.orgQuotaLoading = true;
        });
        builder.addCase(fetchOrgStorageQuota.fulfilled, (state, action) => {
            state.orgQuotaLoading = false;
            state.orgQuota = action.payload.quota;
            state.orgTotalUsedBytes = action.payload.totalUsedBytes;
            state.orgTotalFileCount = action.payload.totalFileCount;
        });
        builder.addCase(fetchOrgStorageQuota.rejected, (state, action) => {
            state.orgQuotaLoading = false;
            state.error = action.error.message || 'Failed to fetch storage quota';
        });

        builder.addCase(setOrgStorageQuota.fulfilled, (state, action) => {
            state.orgQuota = action.payload;
        });

        // Storage: user overrides
        builder.addCase(fetchUserStorageQuotaOverrides.pending, (state) => {
            state.userOverridesLoading = true;
        });
        builder.addCase(fetchUserStorageQuotaOverrides.fulfilled, (state, action) => {
            state.userOverridesLoading = false;
            state.userOverrides = action.payload;
        });
        builder.addCase(fetchUserStorageQuotaOverrides.rejected, (state, action) => {
            state.userOverridesLoading = false;
            state.error = action.error.message || 'Failed to fetch quota overrides';
        });

        builder.addCase(setUserStorageQuotaOverride.fulfilled, (state, action) => {
            const idx = state.userOverrides.findIndex((o) => o.userId === action.payload.userId);
            if (idx !== -1) {
                state.userOverrides[idx] = action.payload;
            } else {
                state.userOverrides.push(action.payload);
            }
        });

        builder.addCase(removeUserStorageQuotaOverride.fulfilled, (state, action) => {
            state.userOverrides = state.userOverrides.filter(
                (o) => o.userId !== action.meta.arg.userId
            );
        });

        // Storage: org usage list
        builder.addCase(fetchOrgStorageUsage.pending, (state) => {
            state.userUsageListLoading = true;
        });
        builder.addCase(fetchOrgStorageUsage.fulfilled, (state, action) => {
            state.userUsageListLoading = false;
            state.userUsageList = action.payload.users;
            state.orgTotalUsedBytes = action.payload.totalUsedBytes;
            state.orgTotalFileCount = action.payload.totalFileCount;
        });
        builder.addCase(fetchOrgStorageUsage.rejected, (state, action) => {
            state.userUsageListLoading = false;
            state.error = action.error.message || 'Failed to fetch storage usage';
        });

        builder.addCase(recalculateStorageUsage.fulfilled, (state, action) => {
            for (const recalc of action.payload) {
                const idx = state.userUsageList.findIndex(
                    (u) => u.userId === recalc.userId
                );
                if (idx !== -1) {
                    state.userUsageList[idx] = recalc;
                }
            }
        });

        builder.addCase(fetchOrganizationSettings.pending, (state) => {
            state.orgSettingsLoading = true;
        });
        builder.addCase(fetchOrganizationSettings.fulfilled, (state, action) => {
            state.orgSettingsLoading = false;
            state.orgSettings = action.payload;
        });
        builder.addCase(fetchOrganizationSettings.rejected, (state, action) => {
            state.orgSettingsLoading = false;
            state.error = action.error.message || 'Failed to fetch organization settings';
        });

        builder.addCase(updateOrganizationSettings.pending, (state) => {
            state.orgSettingsSaving = true;
        });
        builder.addCase(updateOrganizationSettings.fulfilled, (state, action) => {
            state.orgSettingsSaving = false;
            state.orgSettings = action.payload;
        });
        builder.addCase(updateOrganizationSettings.rejected, (state, action) => {
            state.orgSettingsSaving = false;
            state.error = action.error.message || 'Failed to update organization settings';
        });
    },
});

export const { clearAdminError, clearAdmin } = adminSlice.actions;

export const adminReducer = adminSlice.reducer;
