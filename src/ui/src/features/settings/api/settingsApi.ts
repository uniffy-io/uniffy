import { createClient } from "@connectrpc/connect";
import { unaryTransport } from "@/config/api";
import {
  SettingsService,
  GetEffectiveSettingsRequestSchema,
  UpdateProfileRequestSchema,
} from "@uniffy/proto/settings/v1/settings_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";

const settingsClient = createClient(SettingsService, unaryTransport);

export const settingsApi = {
  updateProfile: async (request: MessageInitShape<typeof UpdateProfileRequestSchema>) => {
    return settingsClient.updateProfile(request);
  },

  getEffectiveSettings: async (
    request: MessageInitShape<typeof GetEffectiveSettingsRequestSchema>,
  ) => {
    return settingsClient.getEffectiveSettings(request);
  },
};
