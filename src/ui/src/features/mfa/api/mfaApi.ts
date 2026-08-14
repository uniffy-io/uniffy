import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";

import { transport } from "@/config/api";
import { env } from "@/config/env";

import { MfaService } from "@uniffy/proto/auth/v1/mfa_pb";

export const mfaClient = createClient(MfaService, transport);

/** Bypasses the auth interceptor so a wrong code on VerifyMfa doesn't trigger a refresh-and-bounce. */
const verifyOnlyTransport = createConnectTransport({
  baseUrl: env.apiBaseUrl,
  useBinaryFormat: true,
  defaultTimeoutMs: 10_000,
});

export const mfaUnaryClient = createClient(MfaService, verifyOnlyTransport);
