import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { AuthService } from "@uniffy/proto/auth/v1/auth_connect";
import { OrganizationsService } from "@uniffy/proto/organizations/v1/organizations_connect";
import { ENV } from "@/constants/env";
import { getAccessToken } from "@/lib/auth";
import { transport } from "@/lib/transport";

// Unauthenticated transport for login/register/refresh (no Bearer token)
const publicTransport = createConnectTransport({
  baseUrl: ENV.apiUrl,
});

const publicAuthClient = createClient(AuthService, publicTransport);
const authClient = createClient(AuthService, transport);
const orgsClient = createClient(OrganizationsService, transport);

export const authApi = {
  login: (email: string, password: string) => publicAuthClient.login({ email, password }),

  register: (email: string, username: string, password: string, fullName?: string) =>
    publicAuthClient.register({ email, username, password, fullName }),

  refreshToken: (refreshToken: string, organizationSlug?: string) =>
    publicAuthClient.refreshToken({ refreshToken, organizationSlug }),

  getCurrentUser: () => authClient.getCurrentUser({}),

  logout: (refreshToken?: string) => authClient.logout({ refreshToken }).catch(() => {}),

  listMyOrganizations: () => orgsClient.listMyOrganizations({}),

  listSessions: () => authClient.listSessions({}),

  revokeSession: (sessionId: string) => authClient.revokeSession({ sessionId }),

  revokeOtherSessions: () => authClient.revokeOtherSessions({}),
};
