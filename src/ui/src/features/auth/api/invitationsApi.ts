import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { unaryTransport } from "@/config/api";
import {
  AcceptMyInvitationRequestSchema,
  DeclineMyInvitationRequestSchema,
  OrganizationsService,
} from "@uniffy/proto/organizations/v1/organizations_pb";

const invitationsClient = createClient(OrganizationsService, unaryTransport);

/** Invitations addressed to the signed-in user's email, whichever organization sent them. */
export const invitationsApi = {
  listMyInvitations: async () => {
    return invitationsClient.listMyInvitations({});
  },

  /** Refused with PERMISSION_DENIED when the invitation names another email. */
  acceptMyInvitation: async (request: MessageInitShape<typeof AcceptMyInvitationRequestSchema>) => {
    return invitationsClient.acceptMyInvitation(request);
  },

  declineMyInvitation: async (
    request: MessageInitShape<typeof DeclineMyInvitationRequestSchema>,
  ) => {
    return invitationsClient.declineMyInvitation(request);
  },
};
