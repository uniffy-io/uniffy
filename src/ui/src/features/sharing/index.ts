/**
 * Sharing Feature
 *
 * Provides content permission management with sharing dialog, user/group search,
 * and permission level controls.
 */

// API
export { sharingApi } from './api/sharingApi';

// Components
export { SharingDialog } from './components/SharingDialog';
export { ShareButton } from './components/ShareButton';
export { ShareTargetSearch } from './components/ShareTargetSearch';
export { PermissionRow } from './components/PermissionRow';
export { PermissionLevelSelect } from './components/PermissionLevelSelect';

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
} from './hooks/useSharingHooks';
export type { MyPermission } from './hooks/useSharingHooks';

// Store - Slice & Actions
export {
    default as sharingReducer,
    openSharingDialog,
    closeSharingDialog,
    clearSearchResults,
    clearSharing,
    serializePermissionInfo,
    serializeShareTarget,
} from './store/sharingSlice';
export type {
    SharingState,
    SerializedPermissionInfo,
    SerializedShareTarget,
} from './store/sharingSlice';

// Store - Thunks
export {
    fetchContentPermissions,
    grantPermission,
    revokePermission,
    updatePermission,
    searchShareTargets,
} from './store/sharingThunks';
