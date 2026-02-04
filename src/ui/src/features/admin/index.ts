/**
 * Admin Feature
 *
 * Provides organization administration functionality including
 * permission defaults, group management, and member management.
 */

// API
export { adminApi } from '@/features/admin/api/adminApi';

// Components
export { PermissionDefaultsSection } from '@/features/admin/components/permissions/PermissionDefaultsSection';
export { GroupsSection } from '@/features/admin/components/groups/GroupsSection';
export { MembersSection } from '@/features/admin/components/members/MembersSection';

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
} from '@/features/admin/hooks/useAdminHooks';

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
} from '@/features/admin/store/adminSlice';
export type {
    AdminState,
    SerializedContentTypeDefaults,
    SerializedMemberInfo,
    SerializedGroupInfo,
    SerializedGroupMemberInfo,
    SerializedOrgOverview,
} from '@/features/admin/store/adminSlice';

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
} from '@/features/admin/store/adminThunks';
