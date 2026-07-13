import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  MembersService,
  ListMembersRequestSchema,
  AddMemberRequestSchema,
  UpdateMemberRoleRequestSchema,
  RemoveMemberRequestSchema,
  SetAccessModeRequestSchema,
  TransferOwnershipRequestSchema,
} from "@uniffy/proto/permissions/v1/permissions_pb";
import { transport } from "@core/api/transport";

const client = createClient(MembersService, transport);

export const permissionsApi = {
  listMembers: (req: MessageInitShape<typeof ListMembersRequestSchema>) => client.listMembers(req),
  addMember: (req: MessageInitShape<typeof AddMemberRequestSchema>) => client.addMember(req),
  updateMemberRole: (req: MessageInitShape<typeof UpdateMemberRoleRequestSchema>) =>
    client.updateMemberRole(req),
  removeMember: (req: MessageInitShape<typeof RemoveMemberRequestSchema>) =>
    client.removeMember(req),
  setAccessMode: (req: MessageInitShape<typeof SetAccessModeRequestSchema>) =>
    client.setAccessMode(req),
  transferOwnership: (req: MessageInitShape<typeof TransferOwnershipRequestSchema>) =>
    client.transferOwnership(req),
};
