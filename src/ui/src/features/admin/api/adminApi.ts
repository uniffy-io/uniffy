/**
 * Admin API Service
 *
 * Aggregates organization and group APIs for admin functionality.
 * Delegates to organizations.v1 and groups.v1 services.
 */

import { createClient } from '@connectrpc/connect';
import { unaryTransport } from '@/config/api';
import { OrganizationsService, GetOrganizationOverviewRequestSchema, GetOrganizationSettingsRequestSchema, GetPermissionDefaultsRequestSchema, GetUserDomainAdminsRequestSchema, GrantDomainAdminRequestSchema, ListDomainAdminsRequestSchema, ListMembersRequestSchema, RemoveMemberRequestSchema, RevokeDomainAdminRequestSchema, RotateEncryptionKeyRequestSchema, UpdateMemberRoleRequestSchema, UpdateOrganizationSettingsRequestSchema, UpdatePermissionDefaultsRequestSchema } from '@uniffy/proto/organizations/v1/organizations_pb';
import { GroupsService, AddGroupMemberRequestSchema, CreateGroupRequestSchema, DeleteGroupRequestSchema, ListGroupMembersRequestSchema, ListGroupsRequestSchema, RemoveGroupMemberRequestSchema, UpdateGroupRequestSchema } from '@uniffy/proto/groups/v1/groups_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

/**
 * Create service clients with the shared transport.
 */
const organizationsClient = createClient(OrganizationsService, unaryTransport);
const groupsClient = createClient(GroupsService, unaryTransport);

/**
 * Admin API service with typed methods.
 * Maintains backward compatibility by aggregating organization and group APIs.
 */
export const adminApi = {
    // Permission Defaults (from organizations service)
    getPermissionDefaults: async (request: MessageInitShape<typeof GetPermissionDefaultsRequestSchema>) => {
        return organizationsClient.getPermissionDefaults(request);
    },

    updatePermissionDefaults: async (request: MessageInitShape<typeof UpdatePermissionDefaultsRequestSchema>) => {
        return organizationsClient.updatePermissionDefaults(request);
    },

    // Organization Overview (from organizations service)
    getOrganizationOverview: async (request: MessageInitShape<typeof GetOrganizationOverviewRequestSchema>) => {
        return organizationsClient.getOrganizationOverview(request);
    },

    // Organization Settings (from organizations service)
    getOrganizationSettings: async (request: MessageInitShape<typeof GetOrganizationSettingsRequestSchema>) => {
        return organizationsClient.getOrganizationSettings(request);
    },

    updateOrganizationSettings: async (request: MessageInitShape<typeof UpdateOrganizationSettingsRequestSchema>) => {
        return organizationsClient.updateOrganizationSettings(request);
    },

    // Members (from organizations service)
    listMembers: async (request: MessageInitShape<typeof ListMembersRequestSchema>) => {
        return organizationsClient.listMembers(request);
    },

    updateMemberRole: async (request: MessageInitShape<typeof UpdateMemberRoleRequestSchema>) => {
        return organizationsClient.updateMemberRole(request);
    },

    removeMember: async (request: MessageInitShape<typeof RemoveMemberRequestSchema>) => {
        return organizationsClient.removeMember(request);
    },

    // Groups (from groups service)
    listGroups: async (request: MessageInitShape<typeof ListGroupsRequestSchema>) => {
        return groupsClient.listGroups(request);
    },

    createGroup: async (request: MessageInitShape<typeof CreateGroupRequestSchema>) => {
        return groupsClient.createGroup(request);
    },

    updateGroup: async (request: MessageInitShape<typeof UpdateGroupRequestSchema>) => {
        return groupsClient.updateGroup(request);
    },

    deleteGroup: async (request: MessageInitShape<typeof DeleteGroupRequestSchema>) => {
        return groupsClient.deleteGroup(request);
    },

    // Group Members (from groups service)
    listGroupMembers: async (request: MessageInitShape<typeof ListGroupMembersRequestSchema>) => {
        return groupsClient.listGroupMembers(request);
    },

    addGroupMember: async (request: MessageInitShape<typeof AddGroupMemberRequestSchema>) => {
        return groupsClient.addGroupMember(request);
    },

    removeGroupMember: async (request: MessageInitShape<typeof RemoveGroupMemberRequestSchema>) => {
        return groupsClient.removeGroupMember(request);
    },

    // Domain Admins (from organizations service)
    grantDomainAdmin: async (request: MessageInitShape<typeof GrantDomainAdminRequestSchema>) => {
        return organizationsClient.grantDomainAdmin(request);
    },

    revokeDomainAdmin: async (request: MessageInitShape<typeof RevokeDomainAdminRequestSchema>) => {
        return organizationsClient.revokeDomainAdmin(request);
    },

    listDomainAdmins: async (request: MessageInitShape<typeof ListDomainAdminsRequestSchema>) => {
        return organizationsClient.listDomainAdmins(request);
    },

    getUserDomainAdmins: async (request: MessageInitShape<typeof GetUserDomainAdminsRequestSchema>) => {
        return organizationsClient.getUserDomainAdmins(request);
    },

    // Encryption (from organizations service, org owner only)
    rotateEncryptionKey: async (request: MessageInitShape<typeof RotateEncryptionKeyRequestSchema>) => {
        return organizationsClient.rotateEncryptionKey(request);
    },
};

