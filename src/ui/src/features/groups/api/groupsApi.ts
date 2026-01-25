/**
 * Groups API Service
 *
 * ConnectRPC client for group management operations.
 * Handles group CRUD and membership management.
 */

import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { GroupsService } from '@/gen/groups/v1/groups_connect';
import type {
    ListGroupsRequest,
    GetGroupRequest,
    CreateGroupRequest,
    UpdateGroupRequest,
    DeleteGroupRequest,
    ListGroupMembersRequest,
    AddGroupMemberRequest,
    UpdateGroupMemberRequest,
    RemoveGroupMemberRequest,
    GetUserGroupsRequest,
} from '@/gen/groups/v1/groups_pb';
import type { PartialMessage } from '@bufbuild/protobuf';

/**
 * Create a groups service client with the shared transport.
 */
const groupsClient = createClient(GroupsService, transport);

/**
 * Groups API service with typed methods.
 */
export const groupsApi = {
    // Group CRUD operations
    listGroups: async (request: PartialMessage<ListGroupsRequest>) => {
        return groupsClient.listGroups(request);
    },

    getGroup: async (request: PartialMessage<GetGroupRequest>) => {
        return groupsClient.getGroup(request);
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

    // Group membership operations
    listGroupMembers: async (request: PartialMessage<ListGroupMembersRequest>) => {
        return groupsClient.listGroupMembers(request);
    },

    addGroupMember: async (request: PartialMessage<AddGroupMemberRequest>) => {
        return groupsClient.addGroupMember(request);
    },

    updateGroupMember: async (request: PartialMessage<UpdateGroupMemberRequest>) => {
        return groupsClient.updateGroupMember(request);
    },

    removeGroupMember: async (request: PartialMessage<RemoveGroupMemberRequest>) => {
        return groupsClient.removeGroupMember(request);
    },

    // Bulk operations
    getUserGroups: async (request: PartialMessage<GetUserGroupsRequest>) => {
        return groupsClient.getUserGroups(request);
    },
};

export default groupsApi;
