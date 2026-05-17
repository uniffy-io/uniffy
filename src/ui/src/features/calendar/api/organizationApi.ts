import { createClient } from '@connectrpc/connect';
import { unaryTransport } from '@/config/api';
import { OrganizationsService } from '@uniffy/proto/organizations/v1/organizations_pb';

const client = createClient(OrganizationsService, unaryTransport);

export const organizationApi = {
  listMembers: async (request: {
    organizationId: string;
    search?: string;
    pagination?: { page: number; pageSize: number };
  }) => client.listMembers(request),
};
