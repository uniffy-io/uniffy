export { adminApi } from '@/features/admin/api/adminApi';

export { PermissionDefaultsSection } from '@/features/admin/components/permissions/PermissionDefaultsSection';
export { MembersSection } from '@/features/admin/components/members/MembersSection';

export {
    useAdminAccess,
    usePermissionDefaults,
    useOrganizationOverview,
    useOrgMembers,
    useGroups,
    useGroupMembers,
    getContentTypeLabel,
    getOrgRoleLabel,
    isOrgAdmin,
    useDomainAdmins,
    getDomainTypeLabel,
} from '@/features/admin/hooks/useAdminHooks';

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
