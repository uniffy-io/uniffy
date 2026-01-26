/**
 * Admin Hooks
 *
 * React hooks for organization administration.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { clearAdminError } from '../store/adminSlice';
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
} from '../store/adminThunks';
import { ContentType, VisibilityScope, OrganizationRole } from '@/gen/common/v1/common_pb';

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
                defaultVisibility?: number;
                membersCanView?: boolean;
                membersCanEdit?: boolean;
                membersCanDelete?: boolean;
                membersCanShare?: boolean;
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
            return 'Calendar Events';
        case ContentType.CHAT_MESSAGE:
            return 'Chat Messages';
        case ContentType.USER:
            return 'Users';
        default:
            return 'Unknown';
    }
}

/**
 * Get human-readable label for visibility scope.
 */
export function getVisibilityScopeLabel(scope: number): string {
    switch (scope) {
        case VisibilityScope.PRIVATE:
            return 'Private';
        case VisibilityScope.GROUP:
            return 'Group';
        case VisibilityScope.ORGANIZATION:
            return 'Organization';
        default:
            return 'Unknown';
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
