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
    useDomainAdmins,
    getDomainTypeLabel,
} from '@/features/admin/hooks/useAdminHooks';

// Store - Slice & Actions
export {
    adminReducer,
    clearAdminError,
    clearAdmin,
    serializeContentTypeDefaults,
    serializeMemberInfo,
    serializeGroupInfo,
    serializeGroupMemberInfo,
    serializeOrgOverview,
    serializeDomainAdminInfo,
} from '@/features/admin/store/adminSlice';
export type {
    AdminState,
    SerializedContentTypeDefaults,
    SerializedMemberInfo,
    SerializedGroupInfo,
    SerializedGroupMemberInfo,
    SerializedOrgOverview,
    SerializedDomainAdminInfo,
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
    fetchDomainAdmins,
    grantDomainAdmin,
    revokeDomainAdmin,
} from '@/features/admin/store/adminThunks';
