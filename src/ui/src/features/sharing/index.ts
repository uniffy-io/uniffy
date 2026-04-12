/**
 * Sharing Feature
 *
 * Provides content permission management with sharing dialog, user/group search,
 * and permission level controls.
 */

export { sharingApi } from '@/features/sharing/api/sharingApi';

// Components
export { SharingDialog } from '@/features/sharing/components/SharingDialog';
export { ShareButton } from '@/features/sharing/components/ShareButton';
export { ShareTargetSearch } from '@/features/sharing/components/ShareTargetSearch';
export { PermissionRow } from '@/features/sharing/components/PermissionRow';
export { PermissionLevelSelect } from '@/features/sharing/components/PermissionLevelSelect';

// Hooks
export {
    useSharingDialog,
    useContentPermissions,
    useShareTargetSearch,
    useMyPermission,
    getPermissionLevelLabel,
    getSubjectTypeLabel,
    isUserPermission,
    isGroupPermission,
    isUserTarget,
    isGroupTarget,
    sortPermissions,
} from '@/features/sharing/hooks/useSharingHooks';
export type { MyPermission } from '@/features/sharing/hooks/useSharingHooks';

// Store - Slice & Actions
export {
    sharingReducer,
    openSharingDialog,
    closeSharingDialog,
    clearSearchResults,
    clearSharing,
    serializePermissionInfo,
    serializeShareTarget,
} from '@/features/sharing/store/sharingSlice';
export type {
    SharingState,
    SerializedPermissionInfo,
    SerializedShareTarget,
} from '@/features/sharing/store/sharingSlice';

// Store - Thunks
export {
    fetchContentPermissions,
    grantPermission,
    revokePermission,
    updatePermission,
    searchShareTargets,
} from '@/features/sharing/store/sharingThunks';
