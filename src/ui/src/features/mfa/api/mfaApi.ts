import { createClient } from "@connectrpc/connect";

import { publicUnaryTransport, transport } from "@/config/api";

import { MfaService } from "@uniffy/proto/auth/v1/mfa_pb";

export const mfaClient = createClient(MfaService, transport);

/** Bypasses the auth interceptor so a wrong code on VerifyMfa doesn't trigger a refresh-and-bounce. */
export const mfaUnaryClient = createClient(MfaService, publicUnaryTransport);
