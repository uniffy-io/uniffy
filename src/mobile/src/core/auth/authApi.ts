import { createClient } from "@connectrpc/connect";
import { AuthService } from "@uniffy/proto/auth/v1/auth_pb";
import { MfaService } from "@uniffy/proto/auth/v1/mfa_pb";
import { OrganizationsService } from "@uniffy/proto/organizations/v1/organizations_pb";
import { publicTransport } from "@core/api/publicTransport";
import { transport } from "@core/api/transport";

const publicAuthClient = createClient(AuthService, publicTransport);
const publicMfaClient = createClient(MfaService, publicTransport);
const authClient = createClient(AuthService, transport);
const orgsClient = createClient(OrganizationsService, transport);

export const authApi = {
  login: (email: string, password: string) => publicAuthClient.login({ email, password }),

  register: (email: string, username: string, password: string, fullName?: string) =>
    publicAuthClient.register({ email, username, password, fullName }),

  refreshToken: (refreshToken: string) => publicAuthClient.refreshToken({ refreshToken }),

  // Mints a fresh session bound to the target org (also the first bind after a
  // no-org login). RefreshToken deliberately rejects a cross-org slug.
  switchOrganization: (refreshToken: string, organizationSlug: string) =>
    publicAuthClient.switchOrganization({ refreshToken, organizationSlug }),

  verifyMfa: (challengeToken: string, code: string, method: string) =>
    publicMfaClient.verifyMfa({ challengeToken, code, method }),

  sendPasswordReset: (email: string) => publicAuthClient.sendPasswordReset({ email }),

  getInvitation: (token: string) => publicAuthClient.getInvitation({ token }),

  acceptInvitation: (token: string, username: string, password: string, fullName?: string) =>
    publicAuthClient.acceptInvitation({ token, username, password, fullName }),

  getCurrentUser: () => authClient.getCurrentUser({}),

  logout: (refreshToken?: string) => authClient.logout({ refreshToken }).catch(() => {}),

  listMyOrganizations: () => orgsClient.listMyOrganizations({}),

  listSessions: () => authClient.listSessions({}),

  revokeSession: (sessionId: string) => authClient.revokeSession({ sessionId }),

  revokeOtherSessions: () => authClient.revokeOtherSessions({}),
};
