import { createClient } from "@connectrpc/connect";
import { transport } from "@/config/api";
import {
  SystemConfigService,
  GetSystemConfigRequestSchema,
  GetMfaPolicyRequestSchema,
  GetRealtimeBufferStatusRequestSchema,
  SetPublicRegistrationRequestSchema,
  SetMfaPolicyRequestSchema,
  type OrgCreationPolicy,
} from "@uniffy/proto/superadmin/v1/system_config_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";

const client = createClient(SystemConfigService, transport);

export const systemConfigApi = {
  getSystemConfig: async (request: MessageInitShape<typeof GetSystemConfigRequestSchema> = {}) =>
    client.getSystemConfig(request),

  setPublicRegistration: async (
    request: MessageInitShape<typeof SetPublicRegistrationRequestSchema>,
  ) => client.setPublicRegistration(request),

  setOrgCreationPolicy: async (policy: OrgCreationPolicy) =>
    client.setOrgCreationPolicy({ policy }),

  getMfaPolicy: async (request: MessageInitShape<typeof GetMfaPolicyRequestSchema> = {}) =>
    client.getMfaPolicy(request),

  setMfaPolicy: async (request: MessageInitShape<typeof SetMfaPolicyRequestSchema>) =>
    client.setMfaPolicy(request),

  getRealtimeBufferStatus: async (
    request: MessageInitShape<typeof GetRealtimeBufferStatusRequestSchema> = {},
  ) => client.getRealtimeBufferStatus(request),
};
