import { createClient } from "@connectrpc/connect";
import type { PartialMessage } from "@bufbuild/protobuf";
import { SettingsService } from "@uniffy/proto/settings/v1/settings_connect";
import type {
  GetEffectiveSettingsRequest,
  ListProfilesRequest,
  UpdateProfileRequest,
} from "@uniffy/proto/settings/v1/settings_pb";
import { transport } from "@/lib/transport";

const client = createClient(SettingsService, transport);

export const settingsApi = {
  getEffectiveSettings: (request?: PartialMessage<GetEffectiveSettingsRequest>) =>
    client.getEffectiveSettings(request ?? {}),

  listProfiles: (request?: PartialMessage<ListProfilesRequest>) =>
    client.listProfiles(request ?? {}),

  updateProfile: (request: PartialMessage<UpdateProfileRequest>) => client.updateProfile(request),
};
