import { createClient } from "@connectrpc/connect";
import { transport } from "@/config/api";
import {
  SupportConsentService,
  ApproveSessionRequestSchema,
  GetOrgConsentModeRequestSchema,
  ListOrgSessionsRequestSchema,
  RejectSessionRequestSchema,
  RevokeSessionRequestSchema,
  SetOrgConsentModeRequestSchema,
} from "@uniffy/proto/support/v1/support_consent_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";

const client = createClient(SupportConsentService, transport);

export const supportConsentApi = {
  approve: async (request: MessageInitShape<typeof ApproveSessionRequestSchema>) =>
    client.approveSession(request),

  reject: async (request: MessageInitShape<typeof RejectSessionRequestSchema>) =>
    client.rejectSession(request),

  revoke: async (request: MessageInitShape<typeof RevokeSessionRequestSchema>) =>
    client.revokeSession(request),

  listOrg: async (request: MessageInitShape<typeof ListOrgSessionsRequestSchema>) =>
    client.listOrgSessions(request),

  getOrgConsentMode: async (request: MessageInitShape<typeof GetOrgConsentModeRequestSchema>) =>
    client.getOrgConsentMode(request),

  setOrgConsentMode: async (request: MessageInitShape<typeof SetOrgConsentModeRequestSchema>) =>
    client.setOrgConsentMode(request),
};
