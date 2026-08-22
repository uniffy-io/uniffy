import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  SettingsService,
  GetEffectiveSettingsRequestSchema,
  UpdateProfileRequestSchema,
} from "@uniffy/proto/settings/v1/settings_pb";
import { transport } from "@core/api/transport";

const client = createClient(SettingsService, transport);

export const settingsApi = {
  getEffectiveSettings: (request?: MessageInitShape<typeof GetEffectiveSettingsRequestSchema>) =>
    client.getEffectiveSettings(request ?? {}),

  updateProfile: (request: MessageInitShape<typeof UpdateProfileRequestSchema>) =>
    client.updateProfile(request),
};
