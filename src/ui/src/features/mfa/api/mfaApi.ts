import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';

import { transport } from '@/config/api';
import { env } from '@/config/env';

import { MfaService } from '@uniffy/proto/auth/v1/mfa_pb';

/**
 * Authenticated MFA client. Used for enrollment, status, disable,
 * regenerate, and admin reset RPCs that require an access token (or
 * an enrollment-only token, which the auth interceptor handles the
 * same way as access tokens for the whitelisted RPCs).
 */
export const mfaClient = createClient(MfaService, transport);

/**
 * Bare transport with no auth interceptor. The verify call is mid
 * login: the user holds an mfa_challenge token in the request body
 * but has no access token yet, and a wrong code returns
 * ``UNAUTHENTICATED`` which the shared interceptor would (incorrectly)
 * try to recover from by refreshing tokens and bouncing the user to
 * ``/auth``. We want the inline error banner instead.
 */
const verifyOnlyTransport = createConnectTransport({
    baseUrl: env.apiBaseUrl,
    useBinaryFormat: true,
    defaultTimeoutMs: 10_000,
});

/**
 * Unauthenticated MFA client for ``VerifyMfa``. Carries no bearer
 * token, never triggers the global auth-failure redirect.
 */
export const mfaUnaryClient = createClient(MfaService, verifyOnlyTransport);
