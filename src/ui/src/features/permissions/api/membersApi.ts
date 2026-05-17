import { createClient } from '@connectrpc/connect';
import { unaryTransport } from '@/config/api';
import {
    MembersService,
    ListMembersRequestSchema,
    AddMemberRequestSchema,
    UpdateMemberRoleRequestSchema,
    RemoveMemberRequestSchema,
    SetAccessModeRequestSchema,
    TransferOwnershipRequestSchema,
    ListMemberEventsRequestSchema,
} from '@uniffy/proto/permissions/v1/permissions_pb';
import type {
    ListMembersResponse,
    AddMemberResponse,
    UpdateMemberRoleResponse,
    RemoveMemberResponse,
    SetAccessModeResponse,
    TransferOwnershipResponse,
    ListMemberEventsResponse,
} from '@uniffy/proto/permissions/v1/permissions_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

const client = createClient(MembersService, unaryTransport);

export const membersApi = {
    listMembers: (req: MessageInitShape<typeof ListMembersRequestSchema>): Promise<ListMembersResponse> =>
        client.listMembers(req),
    addMember: (req: MessageInitShape<typeof AddMemberRequestSchema>): Promise<AddMemberResponse> =>
        client.addMember(req),
    updateMemberRole: (req: MessageInitShape<typeof UpdateMemberRoleRequestSchema>): Promise<UpdateMemberRoleResponse> =>
        client.updateMemberRole(req),
    removeMember: (req: MessageInitShape<typeof RemoveMemberRequestSchema>): Promise<RemoveMemberResponse> =>
        client.removeMember(req),
    setAccessMode: (req: MessageInitShape<typeof SetAccessModeRequestSchema>): Promise<SetAccessModeResponse> =>
        client.setAccessMode(req),
    transferOwnership: (req: MessageInitShape<typeof TransferOwnershipRequestSchema>): Promise<TransferOwnershipResponse> =>
        client.transferOwnership(req),
    listMemberEvents: (req: MessageInitShape<typeof ListMemberEventsRequestSchema>): Promise<ListMemberEventsResponse> =>
        client.listMemberEvents(req),
};
