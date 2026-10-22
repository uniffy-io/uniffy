import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { unaryTransport } from "@/config/api";
import {
  CreateOrganizationRequestSchema,
  LeaveOrganizationRequestSchema,
  OrganizationsService,
  ResolveContentOrganizationRequestSchema,
} from "@uniffy/proto/organizations/v1/organizations_pb";

const organizationsClient = createClient(OrganizationsService, unaryTransport);

export const organizationsApi = {
  listMyOrganizations: async () => {
    return organizationsClient.listMyOrganizations({});
  },

  createOrganization: async (request: MessageInitShape<typeof CreateOrganizationRequestSchema>) => {
    return organizationsClient.createOrganization(request);
  },

  leaveOrganization: async (request: MessageInitShape<typeof LeaveOrganizationRequestSchema>) => {
    return organizationsClient.leaveOrganization(request);
  },

  /** Rejects with NOT_FOUND for unknown content, content the caller cannot view, and other tenants. */
  resolveContentOrganization: async (
    request: MessageInitShape<typeof ResolveContentOrganizationRequestSchema>,
  ) => {
    return organizationsClient.resolveContentOrganization(request);
  },
};
