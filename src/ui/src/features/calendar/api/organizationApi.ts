import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { OrganizationsService } from '@/gen/organizations/v1/organizations_connect';

const client = createClient(OrganizationsService, transport);

export const organizationApi = {
  listMembers: async (request: {
    organizationId: string;
    search?: string;
    pagination?: { page: number; pageSize: number };
  }) => client.listMembers(request),
};
