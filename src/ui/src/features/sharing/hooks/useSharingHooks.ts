/**
 * Sharing Hooks
 *
 * React hooks for managing content permissions and sharing.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
    openSharingDialog,
    closeSharingDialog,
    clearSearchResults,
    type SerializedPermissionInfo,
    type SerializedShareTarget,
} from '../store/sharingSlice';
import {
    fetchContentPermissions,
    grantPermission,
    revokePermission,
    updatePermission,
    searchShareTargets,
} from '../store/sharingThunks';
import { sharingApi } from '../api/sharingApi';
import { SubjectType, PermissionLevel, ContentType } from '@/gen/common/v1/common_pb';

/**
 * Get content key for state lookup.
 */
function getContentKey(contentType: number, contentId: string): string {
    return `${contentType}:${contentId}`;
}

/**
 * Hook to manage the sharing dialog state.
 */
export function useSharingDialog() {
    const dispatch = useAppDispatch();
    const activeContent = useAppSelector((state) => state.sharing.activeContent);

    const open = useCallback(
        (contentType: number, contentId: string, title: string) => {
            dispatch(openSharingDialog({ contentType, contentId, title }));
        },
        [dispatch]
    );

    const close = useCallback(() => {
        dispatch(closeSharingDialog());
    }, [dispatch]);

    return {
        isOpen: activeContent !== null,
        activeContent,
        open,
        close,
    };
}

/**
 * Hook to fetch and manage permissions for a piece of content.
 */
export function useContentPermissions(contentType: number, contentId: string) {
    const dispatch = useAppDispatch();
    const key = getContentKey(contentType, contentId);

    const permissions = useAppSelector(
        (state) => state.sharing.permissionsByContent[key] || []
    );
    const owner = useAppSelector((state) => state.sharing.ownerByContent[key] || null);
    const loading = useAppSelector((state) => state.sharing.loading[key] || false);
    const error = useAppSelector((state) => state.sharing.errors[key] || null);

    const refresh = useCallback(() => {
        dispatch(fetchContentPermissions({ contentType, contentId }));
    }, [dispatch, contentType, contentId]);

    // Fetch on mount
    useEffect(() => {
        if (contentId) {
            refresh();
        }
    }, [contentId, refresh]);

    const grant = useCallback(
        async (subjectType: number, subjectId: string, level: number, expiresAt?: Date) => {
            await dispatch(
                grantPermission({
                    contentType,
                    contentId,
                    subjectType,
                    subjectId,
                    level,
                    expiresAt,
                })
            ).unwrap();
        },
        [dispatch, contentType, contentId]
    );

    const revoke = useCallback(
        async (permissionId: string) => {
            await dispatch(
                revokePermission({
                    contentType,
                    contentId,
                    permissionId,
                })
            ).unwrap();
        },
        [dispatch, contentType, contentId]
    );

    const update = useCallback(
        async (permissionId: string, level?: number, expiresAt?: Date | null) => {
            await dispatch(
                updatePermission({
                    permissionId,
                    level,
                    expiresAt,
                })
            ).unwrap();
        },
        [dispatch]
    );

    return {
        permissions,
        owner,
        loading,
        error,
        refresh,
        grant,
        revoke,
        update,
    };
}

/**
 * Hook to search for share targets (users and groups).
 */
export function useShareTargetSearch() {
    const dispatch = useAppDispatch();
    const results = useAppSelector((state) => state.sharing.searchResults);
    const loading = useAppSelector((state) => state.sharing.searchLoading);

    const search = useCallback(
        (query: string, includeUsers = true, includeGroups = true) => {
            if (query.trim().length >= 2) {
                dispatch(searchShareTargets({ query, includeUsers, includeGroups }));
            } else {
                dispatch(clearSearchResults());
            }
        },
        [dispatch]
    );

    const clear = useCallback(() => {
        dispatch(clearSearchResults());
    }, [dispatch]);

    return {
        results,
        loading,
        search,
        clear,
    };
}

/**
 * Get human-readable label for permission level.
 */
export function getPermissionLevelLabel(level: number): string {
    switch (level) {
        case PermissionLevel.VIEW:
            return 'Can view';
        case PermissionLevel.EDIT:
            return 'Can edit';
        case PermissionLevel.ADMIN:
            return 'Admin';
        default:
            return 'Unknown';
    }
}

/**
 * Get human-readable label for subject type.
 */
export function getSubjectTypeLabel(type: number): string {
    switch (type) {
        case SubjectType.USER:
            return 'User';
        case SubjectType.GROUP:
            return 'Group';
        default:
            return 'Unknown';
    }
}

/**
 * Check if a permission is for a user.
 */
export function isUserPermission(permission: SerializedPermissionInfo): boolean {
    return permission.subjectType === SubjectType.USER;
}

/**
 * Check if a permission is for a group.
 */
export function isGroupPermission(permission: SerializedPermissionInfo): boolean {
    return permission.subjectType === SubjectType.GROUP;
}

/**
 * Check if a share target is a user.
 */
export function isUserTarget(target: SerializedShareTarget): boolean {
    return target.type === SubjectType.USER;
}

/**
 * Check if a share target is a group.
 */
export function isGroupTarget(target: SerializedShareTarget): boolean {
    return target.type === SubjectType.GROUP;
}

/**
 * Sort permissions: groups first, then users, alphabetically by name.
 */
export function sortPermissions(permissions: SerializedPermissionInfo[]): SerializedPermissionInfo[] {
    return [...permissions].sort((a, b) => {
        // Groups before users
        if (a.subjectType !== b.subjectType) {
            return a.subjectType === SubjectType.GROUP ? -1 : 1;
        }
        // Alphabetically by name
        const nameA = a.subject?.name || '';
        const nameB = b.subject?.name || '';
        return nameA.localeCompare(nameB);
    });
}

/**
 * Permission info for current user on a piece of content.
 */
export interface MyPermission {
    canView: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canShare: boolean;
    canMove: boolean;
    level: number;
    isOwner: boolean;
}

/**
 * Hook to check the current user's permission on a piece of content.
 * Returns permission flags and loading state.
 */
export function useMyPermission(contentType: number, contentId: string | null): {
    permission: MyPermission | null;
    loading: boolean;
    error: string | null;
} {
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
    const currentUserId = useAppSelector((state) => state.auth.user?.id);

    const [permission, setPermission] = useState<MyPermission | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!contentId || !organizationId) {
            setPermission(null);
            return;
        }

        let cancelled = false;

        const fetchPermission = async () => {
            setLoading(true);
            setError(null);

            try {
                const response = await sharingApi.getMyPermission({
                    organizationId,
                    contentType: contentType as ContentType,
                    contentId,
                });

                if (!cancelled) {
                    setPermission({
                        canView: response.canView,
                        canEdit: response.canEdit,
                        canDelete: response.canDelete,
                        canShare: response.canShare,
                        canMove: response.canMove,
                        level: response.level,
                        // Check if user is owner by comparing subject ID
                        isOwner: response.subject?.id === currentUserId,
                    });
                }
            } catch (err) {
                if (!cancelled) {
                    // If permission check fails, assume view-only for safety
                    setError(err instanceof Error ? err.message : 'Failed to check permissions');
                    setPermission({
                        canView: true,
                        canEdit: false,
                        canDelete: false,
                        canShare: false,
                        canMove: false,
                        level: PermissionLevel.VIEW,
                        isOwner: false,
                    });
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        fetchPermission();

        return () => {
            cancelled = true;
        };
    }, [contentType, contentId, organizationId, currentUserId]);

    return { permission, loading, error };
}
