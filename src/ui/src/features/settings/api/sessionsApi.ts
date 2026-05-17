/**
 * Sessions API - wraps AuthService session management RPCs.
 */

import { createClient } from '@connectrpc/connect';
import { unaryTransport } from '@/config/api';
import { AuthService } from '@uniffy/proto/auth/v1/auth_pb';

const client = createClient(AuthService, unaryTransport);

export const sessionsApi = {
    listSessions: () => client.listSessions({}),
    revokeSession: (sessionId: string) => client.revokeSession({ sessionId }),
    revokeOtherSessions: () => client.revokeOtherSessions({}),
};
