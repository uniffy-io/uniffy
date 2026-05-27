import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import {
    SystemOrganizationsService,
    SystemUsersService,
    DeleteOrganizationRequestSchema,
    ForceLogoutUserRequestSchema,
    GetOrganizationRequestSchema,
    GetUserRequestSchema,
    ListOrganizationsRequestSchema,
    ListUsersRequestSchema,
    RestoreOrganizationRequestSchema,
    SetSystemAdminRequestSchema,
    SuspendOrganizationRequestSchema,
    UnsuspendOrganizationRequestSchema,
} from '@uniffy/proto/superadmin/v1/system_directory_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

const orgsClient = createClient(SystemOrganizationsService, transport);
const usersClient = createClient(SystemUsersService, transport);

export const platformOrgsApi = {
    list: async (request: MessageInitShape<typeof ListOrganizationsRequestSchema>) =>
        orgsClient.listOrganizations(request),

    get: async (request: MessageInitShape<typeof GetOrganizationRequestSchema>) =>
        orgsClient.getOrganization(request),

    suspend: async (request: MessageInitShape<typeof SuspendOrganizationRequestSchema>) =>
        orgsClient.suspendOrganization(request),

    unsuspend: async (request: MessageInitShape<typeof UnsuspendOrganizationRequestSchema>) =>
        orgsClient.unsuspendOrganization(request),

    delete: async (request: MessageInitShape<typeof DeleteOrganizationRequestSchema>) =>
        orgsClient.deleteOrganization(request),

    restore: async (request: MessageInitShape<typeof RestoreOrganizationRequestSchema>) =>
        orgsClient.restoreOrganization(request),
};

export const platformUsersApi = {
    list: async (request: MessageInitShape<typeof ListUsersRequestSchema>) =>
        usersClient.listUsers(request),

    get: async (request: MessageInitShape<typeof GetUserRequestSchema>) =>
        usersClient.getUser(request),

    forceLogout: async (request: MessageInitShape<typeof ForceLogoutUserRequestSchema>) =>
        usersClient.forceLogoutUser(request),

    setSystemAdmin: async (request: MessageInitShape<typeof SetSystemAdminRequestSchema>) =>
        usersClient.setSystemAdmin(request),
};
