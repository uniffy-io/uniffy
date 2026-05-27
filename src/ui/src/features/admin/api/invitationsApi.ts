import { createClient } from '@connectrpc/connect';
import type { MessageInitShape } from '@bufbuild/protobuf';
import { unaryTransport } from '@/config/api';
import {
    OrganizationsService,
    InviteMemberRequestSchema,
    ListInvitationsRequestSchema,
    ResendInvitationRequestSchema,
    RevokeInvitationRequestSchema,
} from '@uniffy/proto/organizations/v1/organizations_pb';

const client = createClient(OrganizationsService, unaryTransport);

export const invitationsApi = {
    invite: async (request: MessageInitShape<typeof InviteMemberRequestSchema>) =>
        client.inviteMember(request),

    list: async (request: MessageInitShape<typeof ListInvitationsRequestSchema>) =>
        client.listInvitations(request),

    revoke: async (request: MessageInitShape<typeof RevokeInvitationRequestSchema>) =>
        client.revokeInvitation(request),

    resend: async (request: MessageInitShape<typeof ResendInvitationRequestSchema>) =>
        client.resendInvitation(request),
};
