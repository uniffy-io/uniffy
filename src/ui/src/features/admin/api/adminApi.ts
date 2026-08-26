import { createClient } from "@connectrpc/connect";
import { unaryTransport } from "@/config/api";
import {
  OrganizationsService,
  GetOrganizationOverviewRequestSchema,
  GetPermissionDefaultsRequestSchema,
  GetUserDomainAdminsRequestSchema,
  GrantDomainAdminRequestSchema,
  ListDomainAdminsRequestSchema,
  ListMembersRequestSchema,
  RemoveMemberRequestSchema,
  RevokeDomainAdminRequestSchema,
  RotateEncryptionKeyRequestSchema,
  UpdateMemberRoleRequestSchema,
  UpdatePermissionDefaultsRequestSchema,
} from "@uniffy/proto/organizations/v1/organizations_pb";
import {
  GroupsService,
  AddGroupMemberRequestSchema,
  CreateGroupRequestSchema,
  DeleteGroupRequestSchema,
  ListGroupMembersRequestSchema,
  ListGroupsRequestSchema,
  RemoveGroupMemberRequestSchema,
  UpdateGroupRequestSchema,
} from "@uniffy/proto/groups/v1/groups_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";

const organizationsClient = createClient(OrganizationsService, unaryTransport);
const groupsClient = createClient(GroupsService, unaryTransport);

export const adminApi = {
  getPermissionDefaults: async (
    request: MessageInitShape<typeof GetPermissionDefaultsRequestSchema>,
  ) => {
    return organizationsClient.getPermissionDefaults(request);
  },

  updatePermissionDefaults: async (
    request: MessageInitShape<typeof UpdatePermissionDefaultsRequestSchema>,
  ) => {
    return organizationsClient.updatePermissionDefaults(request);
  },

  getOrganizationOverview: async (
    request: MessageInitShape<typeof GetOrganizationOverviewRequestSchema>,
  ) => {
    return organizationsClient.getOrganizationOverview(request);
  },

  listMembers: async (request: MessageInitShape<typeof ListMembersRequestSchema>) => {
    return organizationsClient.listMembers(request);
  },

  updateMemberRole: async (request: MessageInitShape<typeof UpdateMemberRoleRequestSchema>) => {
    return organizationsClient.updateMemberRole(request);
  },

  removeMember: async (request: MessageInitShape<typeof RemoveMemberRequestSchema>) => {
    return organizationsClient.removeMember(request);
  },

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

  listGroupMembers: async (request: MessageInitShape<typeof ListGroupMembersRequestSchema>) => {
    return groupsClient.listGroupMembers(request);
  },

  addGroupMember: async (request: MessageInitShape<typeof AddGroupMemberRequestSchema>) => {
    return groupsClient.addGroupMember(request);
  },

  removeGroupMember: async (request: MessageInitShape<typeof RemoveGroupMemberRequestSchema>) => {
    return groupsClient.removeGroupMember(request);
  },

  grantDomainAdmin: async (request: MessageInitShape<typeof GrantDomainAdminRequestSchema>) => {
    return organizationsClient.grantDomainAdmin(request);
  },

  revokeDomainAdmin: async (request: MessageInitShape<typeof RevokeDomainAdminRequestSchema>) => {
    return organizationsClient.revokeDomainAdmin(request);
  },

  listDomainAdmins: async (request: MessageInitShape<typeof ListDomainAdminsRequestSchema>) => {
    return organizationsClient.listDomainAdmins(request);
  },

  getUserDomainAdmins: async (
    request: MessageInitShape<typeof GetUserDomainAdminsRequestSchema>,
  ) => {
    return organizationsClient.getUserDomainAdmins(request);
  },

  rotateEncryptionKey: async (
    request: MessageInitShape<typeof RotateEncryptionKeyRequestSchema>,
  ) => {
    return organizationsClient.rotateEncryptionKey(request);
  },
};
