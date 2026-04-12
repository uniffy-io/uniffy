import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { MembersService } from '@uniffy/proto/permissions/v1/permissions_connect';
import type {
    ListMembersRequest,
    ListMembersResponse,
    AddMemberRequest,
    UpdateMemberRoleRequest,
    RemoveMemberRequest,
    RemoveMemberResponse,
    SetAccessModeRequest,
    AccessModeResponse,
    TransferOwnershipRequest,
    TransferOwnershipResponse,
    MemberResponse,
    ListMemberEventsRequest,
    ListMemberEventsResponse,
} from '@uniffy/proto/permissions/v1/permissions_pb';

const client = createClient(MembersService, transport);

export const membersApi = {
    listMembers: (req: Partial<ListMembersRequest>): Promise<ListMembersResponse> =>
        client.listMembers(req),
    addMember: (req: Partial<AddMemberRequest>): Promise<MemberResponse> =>
        client.addMember(req),
    updateMemberRole: (req: Partial<UpdateMemberRoleRequest>): Promise<MemberResponse> =>
        client.updateMemberRole(req),
    removeMember: (req: Partial<RemoveMemberRequest>): Promise<RemoveMemberResponse> =>
        client.removeMember(req),
    setAccessMode: (req: Partial<SetAccessModeRequest>): Promise<AccessModeResponse> =>
        client.setAccessMode(req),
    transferOwnership: (req: Partial<TransferOwnershipRequest>): Promise<TransferOwnershipResponse> =>
        client.transferOwnership(req),
    listMemberEvents: (req: Partial<ListMemberEventsRequest>): Promise<ListMemberEventsResponse> =>
        client.listMemberEvents(req),
};
