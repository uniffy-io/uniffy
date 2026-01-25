/**
 * Admin Feature
 *
 * Provides organization administration functionality including
 * permission defaults, group management, and member management.
 */

// API
export { adminApi } from './api/adminApi';

// Components
export { PermissionDefaultsSection } from './components/permissions/PermissionDefaultsSection';
export { GroupsSection } from './components/groups/GroupsSection';
export { MembersSection } from './components/members/MembersSection';

// Hooks
export {
    useAdminAccess,
    usePermissionDefaults,
    useOrganizationOverview,
    useOrgMembers,
    useGroups,
    useGroupMembers,
    getContentTypeLabel,
    getVisibilityScopeLabel,
    getOrgRoleLabel,
    isOrgAdmin,
} from './hooks/useAdminHooks';

// Store - Slice & Actions
export {
    default as adminReducer,
    clearAdminError,
    clearAdmin,
    serializeContentTypeDefaults,
    serializeMemberInfo,
    serializeGroupInfo,
    serializeGroupMemberInfo,
    serializeOrgOverview,
} from './store/adminSlice';
export type {
    AdminState,
    SerializedContentTypeDefaults,
    SerializedMemberInfo,
    SerializedGroupInfo,
    SerializedGroupMemberInfo,
    SerializedOrgOverview,
} from './store/adminSlice';

// Store - Thunks
export {
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
} from './store/adminThunks';
