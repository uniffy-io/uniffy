/**
 * Admin Hooks
 *
 * React hooks for organization administration.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { clearAdminError } from '@/features/admin/store/adminSlice';
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
} from '@/features/admin/store/adminThunks';
import { ContentType, AccessMode, ContentRole, OrganizationRole, DomainType } from '@uniffy/proto/common/v1/common_pb';

/**
 * Hook for checking admin access permissions.
 *
 * Returns flags indicating whether the current user is an org admin or system admin,
 * and whether they can access the admin panel.
 *
 * @returns Object with isOrgAdmin, isSystemAdmin, and canAccessAdmin flags
 */
export function useAdminAccess() {
    const user = useAppSelector((state) => state.auth.user);
    const currentOrganizationRole = useAppSelector((state) => state.auth.currentOrganizationRole);

    return useMemo(() => {
        const isSystemAdmin = user?.isSystemAdmin ?? false;
        const isOrgAdminRole = ['ADMIN', 'OWNER'].includes(currentOrganizationRole ?? '');

        return {
            /** Whether the user is a system-wide administrator */
            isSystemAdmin,
            /** Whether the user is an admin/owner of the current organization */
            isOrgAdmin: isOrgAdminRole,
            /** Whether the user can access the admin panel (org admin or system admin) */
            canAccessAdmin: isOrgAdminRole || isSystemAdmin,
            /** Whether the user can access organization-level admin sections */
            canAccessOrgSection: isOrgAdminRole || isSystemAdmin,
            /** Whether the user can access server-level admin sections */
            canAccessServerSection: isSystemAdmin,
        };
    }, [user?.isSystemAdmin, currentOrganizationRole]);
}

/**
 * Hook for managing permission defaults.
 */
export function usePermissionDefaults() {
    const dispatch = useAppDispatch();
    const defaults = useAppSelector((state) => state.admin.permissionDefaults);
    const loading = useAppSelector((state) => state.admin.permissionDefaultsLoading);
    const error = useAppSelector((state) => state.admin.permissionDefaultsError);

    const refresh = useCallback(() => {
        dispatch(fetchPermissionDefaults());
    }, [dispatch]);

    const update = useCallback(
        async (
            contentType: number,
            updates: {
                defaultAccessMode?: number;
                defaultBaselineRole?: number | null;
            }
        ) => {
            await dispatch(
                updatePermissionDefaults({
                    contentType,
                    ...updates,
                })
            ).unwrap();
        },
        [dispatch]
    );

    const dismissError = useCallback(() => {
        dispatch(clearAdminError());
    }, [dispatch]);

    return {
        defaults,
        loading,
        error,
        refresh,
        update,
        dismissError,
    };
}

/**
 * Hook for organization overview.
 */
export function useOrganizationOverview() {
    const dispatch = useAppDispatch();
    const overview = useAppSelector((state) => state.admin.overview);
    const loading = useAppSelector((state) => state.admin.overviewLoading);

    const refresh = useCallback(() => {
        dispatch(fetchOrganizationOverview());
    }, [dispatch]);

    // Fetch on mount
    useEffect(() => {
        refresh();
    }, [refresh]);

    return {
        overview,
        loading,
        refresh,
    };
}

/**
 * Hook for managing organization members.
 */
export function useOrgMembers() {
    const dispatch = useAppDispatch();
    const members = useAppSelector((state) => state.admin.members);
    const loading = useAppSelector((state) => state.admin.membersLoading);
    const totalCount = useAppSelector((state) => state.admin.membersTotalCount);
    const error = useAppSelector((state) => state.admin.error);

    const refresh = useCallback(
        (options?: { page?: number; pageSize?: number; roleFilter?: number; search?: string }) => {
            dispatch(fetchMembers(options || {}));
        },
        [dispatch]
    );

    const updateRole = useCallback(
        async (userId: string, role: number) => {
            await dispatch(updateMemberRole({ userId, role })).unwrap();
        },
        [dispatch]
    );

    const remove = useCallback(
        async (userId: string) => {
            await dispatch(removeMember({ userId })).unwrap();
        },
        [dispatch]
    );

    return {
        members,
        loading,
        totalCount,
        error,
        refresh,
        updateRole,
        remove,
    };
}

/**
 * Hook for managing groups.
 */
export function useGroups() {
    const dispatch = useAppDispatch();
    const groups = useAppSelector((state) => state.admin.groups);
    const loading = useAppSelector((state) => state.admin.groupsLoading);
    const totalCount = useAppSelector((state) => state.admin.groupsTotalCount);

    const refresh = useCallback(
        (options?: { page?: number; pageSize?: number }) => {
            dispatch(fetchGroups(options || {}));
        },
        [dispatch]
    );

    const create = useCallback(
        async (name: string, description?: string) => {
            return await dispatch(createGroup({ name, description })).unwrap();
        },
        [dispatch]
    );

    const update = useCallback(
        async (groupId: string, updates: { name?: string; description?: string }) => {
            await dispatch(updateGroup({ groupId, ...updates })).unwrap();
        },
        [dispatch]
    );

    const remove = useCallback(
        async (groupId: string) => {
            await dispatch(deleteGroup({ groupId })).unwrap();
        },
        [dispatch]
    );

    return {
        groups,
        loading,
        totalCount,
        refresh,
        create,
        update,
        remove,
    };
}

/**
 * Hook for managing group members.
 */
export function useGroupMembers(groupId: string) {
    const dispatch = useAppDispatch();
    const members = useAppSelector((state) => state.admin.groupMembers[groupId] || []);
    const loading = useAppSelector((state) => state.admin.groupMembersLoading[groupId] || false);

    const refresh = useCallback(
        (options?: { page?: number; pageSize?: number }) => {
            dispatch(fetchGroupMembers({ groupId, ...options }));
        },
        [dispatch, groupId]
    );

    const add = useCallback(
        async (userId: string, role?: number) => {
            await dispatch(addGroupMember({ groupId, userId, role })).unwrap();
        },
        [dispatch, groupId]
    );

    const remove = useCallback(
        async (userId: string) => {
            await dispatch(removeGroupMember({ groupId, userId })).unwrap();
        },
        [dispatch, groupId]
    );

    // Fetch on mount
    useEffect(() => {
        if (groupId) {
            refresh();
        }
    }, [groupId, refresh]);

    return {
        members,
        loading,
        refresh,
        add,
        remove,
    };
}

/**
 * Get human-readable label for content type.
 */
export function getContentTypeLabel(contentType: number): string {
    switch (contentType) {
        case ContentType.NOTE:
            return 'Notes';
        case ContentType.FILE:
            return 'Files';
        case ContentType.CALENDAR_EVENT:
            return 'Calendar';
        case ContentType.CHAT_MESSAGE:
            return 'Chat Messages';
        case ContentType.USER:
            return 'Users';
        case ContentType.PROJECT:
            return 'Projects';
        case ContentType.AGENT:
            return 'Agents';
        default:
            return 'Unknown';
    }
}

/**
 * Get human-readable label for access mode.
 */
export function getAccessModeLabel(mode: number): string {
    switch (mode) {
        case AccessMode.OWNER_ONLY:
            return 'Owner Only';
        case AccessMode.EXPLICIT_MEMBERS:
            return 'Explicit Members';
        case AccessMode.OPEN_TO_ORG:
            return 'Open to Organization';
        default:
            return 'Unknown';
    }
}

/**
 * Get human-readable label for content role.
 */
export function getContentRoleLabel(role: number): string {
    switch (role) {
        case ContentRole.VIEWER:
            return 'Viewer';
        case ContentRole.COMMENTER:
            return 'Commenter';
        case ContentRole.EDITOR:
            return 'Editor';
        case ContentRole.ADMIN:
            return 'Admin';
        case ContentRole.OWNER:
            return 'Owner';
        case ContentRole.BLOCKED:
            return 'Blocked';
        default:
            return 'None';
    }
}

/**
 * Get human-readable label for organization role.
 */
export function getOrgRoleLabel(role: number): string {
    switch (role) {
        case OrganizationRole.OWNER:
            return 'Owner';
        case OrganizationRole.ADMIN:
            return 'Admin';
        case OrganizationRole.MEMBER:
            return 'Member';
        default:
            return 'Unknown';
    }
}

/**
 * Check if a role is admin or higher.
 */
export function isOrgAdmin(role: number): boolean {
    return role === OrganizationRole.OWNER || role === OrganizationRole.ADMIN;
}

/**
 * Hook for managing domain admins.
 */
export function useDomainAdmins() {
    const dispatch = useAppDispatch();
    const domainAdmins = useAppSelector((state) => state.admin.domainAdmins);
    const loading = useAppSelector((state) => state.admin.domainAdminsLoading);
    const totalCount = useAppSelector((state) => state.admin.domainAdminsTotalCount);

    const refresh = useCallback(
        (options?: { domainFilter?: number; page?: number; pageSize?: number }) => {
            dispatch(fetchDomainAdmins(options || {}));
        },
        [dispatch],
    );

    const grant = useCallback(
        async (userId: string, domain: number) => {
            await dispatch(grantDomainAdmin({ userId, domain })).unwrap();
        },
        [dispatch],
    );

    const revoke = useCallback(
        async (userId: string, domain: number) => {
            await dispatch(revokeDomainAdmin({ userId, domain })).unwrap();
        },
        [dispatch],
    );

    return { domainAdmins, loading, totalCount, refresh, grant, revoke };
}

/**
 * Get human-readable label for a domain type.
 */
export function getDomainTypeLabel(domain: number): string {
    switch (domain) {
        case DomainType.CHAT:
            return 'Chat';
        case DomainType.FILES:
            return 'Files';
        case DomainType.NOTES:
            return 'Notes';
        case DomainType.CALENDAR:
            return 'Calendar';
        case DomainType.PROJECTS:
            return 'Projects';
        case DomainType.AGENTS:
            return 'Agents';
        default:
            return 'Unknown';
    }
}
