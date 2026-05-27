import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import {
    SupportService,
    ApproveSessionRequestSchema,
    GetOrgConsentModeRequestSchema,
    ListAllSessionsRequestSchema,
    ListMySessionsRequestSchema,
    ListOrgSessionsRequestSchema,
    RejectSessionRequestSchema,
    RequestSessionRequestSchema,
    RevokeSessionRequestSchema,
    SetOrgConsentModeRequestSchema,
} from '@uniffy/proto/superadmin/v1/support_session_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

const client = createClient(SupportService, transport);

export const supportSessionsApi = {
    request: async (request: MessageInitShape<typeof RequestSessionRequestSchema>) =>
        client.requestSession(request),

    approve: async (request: MessageInitShape<typeof ApproveSessionRequestSchema>) =>
        client.approveSession(request),

    reject: async (request: MessageInitShape<typeof RejectSessionRequestSchema>) =>
        client.rejectSession(request),

    revoke: async (request: MessageInitShape<typeof RevokeSessionRequestSchema>) =>
        client.revokeSession(request),

    listMy: async (request: MessageInitShape<typeof ListMySessionsRequestSchema>) =>
        client.listMySessions(request),

    listOrg: async (request: MessageInitShape<typeof ListOrgSessionsRequestSchema>) =>
        client.listOrgSessions(request),

    listAll: async (request: MessageInitShape<typeof ListAllSessionsRequestSchema>) =>
        client.listAllSessions(request),

    getOrgConsentMode: async (
        request: MessageInitShape<typeof GetOrgConsentModeRequestSchema>,
    ) => client.getOrgConsentMode(request),

    setOrgConsentMode: async (
        request: MessageInitShape<typeof SetOrgConsentModeRequestSchema>,
    ) => client.setOrgConsentMode(request),
};
