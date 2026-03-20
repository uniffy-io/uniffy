/**
 * Sessions API - wraps AuthService session management RPCs.
 */

import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { AuthService } from '@uniffy/proto/auth/v1/auth_connect';

const client = createClient(AuthService, transport);

export const sessionsApi = {
    listSessions: () => client.listSessions({}),
    revokeSession: (sessionId: string) => client.revokeSession({ sessionId }),
    revokeOtherSessions: () => client.revokeOtherSessions({}),
};
