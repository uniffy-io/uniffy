import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { publicUnaryTransport } from "@/config/api";
import {
  AuthService,
  LoginRequestSchema,
  RegisterRequestSchema,
  SetupDeploymentRequestSchema,
} from "@uniffy/proto/auth/v1/auth_pb";

/** Calls made before a session exists, so they ride the transport without the auth interceptor. */
const publicAuthClient = createClient(AuthService, publicUnaryTransport);

export const authApi = {
  getAuthConfig: async () => {
    return publicAuthClient.getAuthConfig({});
  },

  login: async (request: MessageInitShape<typeof LoginRequestSchema>) => {
    return publicAuthClient.login(request);
  },

  register: async (request: MessageInitShape<typeof RegisterRequestSchema>) => {
    return publicAuthClient.register(request);
  },

  /** Refused with FAILED_PRECONDITION once the deployment has any account. */
  setupDeployment: async (request: MessageInitShape<typeof SetupDeploymentRequestSchema>) => {
    return publicAuthClient.setupDeployment(request);
  },
};
