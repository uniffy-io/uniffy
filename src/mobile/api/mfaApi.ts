import { createClient } from "@connectrpc/connect";
import { MfaService } from "@uniffy/proto/auth/v1/mfa_pb";
import { transport } from "@/lib/transport";

// Authenticated MfaService client. Self-service enrollment + management use the
// session bearer; forced-enrollment-at-login swaps the bearer to the short-lived
// enrollment_token (see auth-context.beginForcedEnrollment) before calling these.
const client = createClient(MfaService, transport);

export const mfaApi = {
  getMfaStatus: () => client.getMfaStatus({}),
  beginEnrollment: () => client.beginEnrollment({}),
  confirmEnrollment: (code: string) => client.confirmEnrollment({ code }),
  disableMfa: (code: string) => client.disableMfa({ code }),
  regenerateRecoveryCodes: (code: string) => client.regenerateRecoveryCodes({ code }),
};
