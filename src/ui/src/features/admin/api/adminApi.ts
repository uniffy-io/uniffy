/**
 * Admin API Service
 *
 * Aggregates organization and group APIs for admin functionality.
 * Delegates to organizations.v1 and groups.v1 services.
 */

import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { OrganizationsService } from '@/gen/organizations/v1/organizations_connect';
import { GroupsService } from '@/gen/groups/v1/groups_connect';
import type {
    GetPermissionDefaultsRequest,
    UpdatePermissionDefaultsRequest,
    GetOrganizationOverviewRequest,
    ListMembersRequest,
    UpdateMemberRoleRequest,
    RemoveMemberRequest,
} from '@/gen/organizations/v1/organizations_pb';
import type {
    ListGroupsRequest,
    CreateGroupRequest,
    UpdateGroupRequest,
    DeleteGroupRequest,
    ListGroupMembersRequest,
    AddGroupMemberRequest,
    RemoveGroupMemberRequest,
} from '@/gen/groups/v1/groups_pb';
import type { PartialMessage } from '@bufbuild/protobuf';

/**
 * Create service clients with the shared transport.
 */
const organizationsClient = createClient(OrganizationsService, transport);
const groupsClient = createClient(GroupsService, transport);

/**
 * Admin API service with typed methods.
 * Maintains backward compatibility by aggregating organization and group APIs.
 */
export const adminApi = {
    // Permission Defaults (from organizations service)
    getPermissionDefaults: async (request: PartialMessage<GetPermissionDefaultsRequest>) => {
        return organizationsClient.getPermissionDefaults(request);
    },

    updatePermissionDefaults: async (request: PartialMessage<UpdatePermissionDefaultsRequest>) => {
        return organizationsClient.updatePermissionDefaults(request);
    },

    // Organization Overview (from organizations service)
    getOrganizationOverview: async (request: PartialMessage<GetOrganizationOverviewRequest>) => {
        return organizationsClient.getOrganizationOverview(request);
    },

    // Members (from organizations service)
    listMembers: async (request: PartialMessage<ListMembersRequest>) => {
        return organizationsClient.listMembers(request);
    },

    updateMemberRole: async (request: PartialMessage<UpdateMemberRoleRequest>) => {
        return organizationsClient.updateMemberRole(request);
    },

    removeMember: async (request: PartialMessage<RemoveMemberRequest>) => {
        return organizationsClient.removeMember(request);
    },

    // Groups (from groups service)
    listGroups: async (request: PartialMessage<ListGroupsRequest>) => {
        return groupsClient.listGroups(request);
    },

    createGroup: async (request: PartialMessage<CreateGroupRequest>) => {
        return groupsClient.createGroup(request);
    },

    updateGroup: async (request: PartialMessage<UpdateGroupRequest>) => {
        return groupsClient.updateGroup(request);
    },

    deleteGroup: async (request: PartialMessage<DeleteGroupRequest>) => {
        return groupsClient.deleteGroup(request);
    },

    // Group Members (from groups service)
    listGroupMembers: async (request: PartialMessage<ListGroupMembersRequest>) => {
        return groupsClient.listGroupMembers(request);
    },

    addGroupMember: async (request: PartialMessage<AddGroupMemberRequest>) => {
        return groupsClient.addGroupMember(request);
    },

    removeGroupMember: async (request: PartialMessage<RemoveGroupMemberRequest>) => {
        return groupsClient.removeGroupMember(request);
    },
};

