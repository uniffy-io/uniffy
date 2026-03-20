/**
 * Sharing Redux Slice
 *
 * Manages state for content permissions and share targets.
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { PermissionInfo, ShareTarget } from '@uniffy/proto/permissions/v1/permissions_pb';
import {
    fetchContentPermissions,
    grantPermission,
    revokePermission,
    updatePermission,
    searchShareTargets,
} from '@/features/sharing/store/sharingThunks';

/**
 * Serialized permission info for Redux store.
 */
export interface SerializedPermissionInfo {
    id: string;
    contentType: number;
    contentId: string;
    subjectType: number;
    subject: SerializedShareTarget | null;
    level: number;
    canView: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canShare: boolean;
    canMove: boolean;
    grantedBy: SerializedShareTarget | null;
    grantedAt: { seconds: number; nanos: number } | null;
    expiresAt: { seconds: number; nanos: number } | null;
}

/**
 * Serialized share target for Redux store.
 */
export interface SerializedShareTarget {
    id: string;
    type: number;
    name: string;
    email: string;
    avatarUrl: string;
    memberCount: number;
}

/**
 * Serialize a PermissionInfo proto to plain object.
 * Converts bigint timestamps to numbers for Redux serialization.
 */
export function serializePermissionInfo(info: PermissionInfo): SerializedPermissionInfo {
    return {
        id: info.id,
        contentType: info.contentType,
        contentId: info.contentId,
        subjectType: info.subjectType,
        subject: info.subject ? serializeShareTarget(info.subject) : null,
        level: info.level,
        canView: info.canView,
        canEdit: info.canEdit,
        canDelete: info.canDelete,
        canShare: info.canShare,
        canMove: info.canMove,
        grantedBy: info.grantedBy ? serializeShareTarget(info.grantedBy) : null,
        grantedAt: info.grantedAt ? { seconds: Number(info.grantedAt.seconds), nanos: info.grantedAt.nanos } : null,
        expiresAt: info.expiresAt ? { seconds: Number(info.expiresAt.seconds), nanos: info.expiresAt.nanos } : null,
    };
}

/**
 * Serialize a ShareTarget proto to plain object.
 */
export function serializeShareTarget(target: ShareTarget): SerializedShareTarget {
    return {
        id: target.id,
        type: target.type,
        name: target.name,
        email: target.email,
        avatarUrl: target.avatarUrl,
        memberCount: target.memberCount,
    };
}

/**
 * Content key for permissions cache.
 */
function getContentKey(contentType: number, contentId: string): string {
    return `${contentType}:${contentId}`;
}

export interface SharingState {
    /** Permissions indexed by content key (contentType:contentId) */
    permissionsByContent: Record<string, SerializedPermissionInfo[]>;
    /** Owner indexed by content key */
    ownerByContent: Record<string, SerializedShareTarget | null>;
    /** Loading state indexed by content key */
    loading: Record<string, boolean>;
    /** Error state indexed by content key */
    errors: Record<string, string | null>;
    /** Search results for share targets */
    searchResults: SerializedShareTarget[];
    /** Search loading state */
    searchLoading: boolean;
    /** Currently open sharing dialog content */
    activeContent: { contentType: number; contentId: string; title: string } | null;
}

const initialState: SharingState = {
    permissionsByContent: {},
    ownerByContent: {},
    loading: {},
    errors: {},
    searchResults: [],
    searchLoading: false,
    activeContent: null,
};

const sharingSlice = createSlice({
    name: 'sharing',
    initialState,
    reducers: {
        /**
         * Open the sharing dialog for a piece of content.
         */
        openSharingDialog: (
            state,
            action: PayloadAction<{ contentType: number; contentId: string; title: string }>
        ) => {
            state.activeContent = action.payload;
        },
        /**
         * Close the sharing dialog.
         */
        closeSharingDialog: (state) => {
            state.activeContent = null;
            state.searchResults = [];
        },
        /**
         * Clear search results.
         */
        clearSearchResults: (state) => {
            state.searchResults = [];
        },
        /**
         * Clear all sharing state (for logout).
         */
        clearSharing: () => initialState,
    },
    extraReducers: (builder) => {
        // Fetch permissions
        builder.addCase(fetchContentPermissions.pending, (state, action) => {
            const key = getContentKey(action.meta.arg.contentType, action.meta.arg.contentId);
            state.loading[key] = true;
            state.errors[key] = null;
        });
        builder.addCase(fetchContentPermissions.fulfilled, (state, action) => {
            const key = getContentKey(action.meta.arg.contentType, action.meta.arg.contentId);
            state.loading[key] = false;
            state.permissionsByContent[key] = action.payload.permissions;
            state.ownerByContent[key] = action.payload.owner;
        });
        builder.addCase(fetchContentPermissions.rejected, (state, action) => {
            const key = getContentKey(action.meta.arg.contentType, action.meta.arg.contentId);
            state.loading[key] = false;
            state.errors[key] = action.error.message || 'Failed to fetch permissions';
        });

        // Grant permission
        builder.addCase(grantPermission.fulfilled, (state, action) => {
            const key = getContentKey(action.payload.contentType, action.payload.contentId);
            const permissions = state.permissionsByContent[key] || [];
            // Add new permission to the list
            state.permissionsByContent[key] = [...permissions, action.payload];
        });

        // Revoke permission
        builder.addCase(revokePermission.fulfilled, (state, action) => {
            const { contentType, contentId, permissionId } = action.meta.arg;
            const key = getContentKey(contentType, contentId);
            const permissions = state.permissionsByContent[key] || [];
            state.permissionsByContent[key] = permissions.filter((p) => p.id !== permissionId);
        });

        // Update permission
        builder.addCase(updatePermission.fulfilled, (state, action) => {
            const key = getContentKey(action.payload.contentType, action.payload.contentId);
            const permissions = state.permissionsByContent[key] || [];
            const index = permissions.findIndex((p) => p.id === action.payload.id);
            if (index !== -1) {
                permissions[index] = action.payload;
                state.permissionsByContent[key] = [...permissions];
            }
        });

        // Search share targets
        builder.addCase(searchShareTargets.pending, (state) => {
            state.searchLoading = true;
        });
        builder.addCase(searchShareTargets.fulfilled, (state, action) => {
            state.searchLoading = false;
            state.searchResults = action.payload;
        });
        builder.addCase(searchShareTargets.rejected, (state) => {
            state.searchLoading = false;
            state.searchResults = [];
        });
    },
});

export const {
    openSharingDialog,
    closeSharingDialog,
    clearSearchResults,
    clearSharing,
} = sharingSlice.actions;

export const sharingReducer = sharingSlice.reducer;
