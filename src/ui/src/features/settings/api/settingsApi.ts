import { createClient } from "@connectrpc/connect";
import { unaryTransport } from "@/config/api";
import {
  SettingsService,
  CreateProfileRequestSchema,
  DeleteProfileRequestSchema,
  GetEffectiveSettingsRequestSchema,
  GetProfileRequestSchema,
  GetSettingsSchemaRequestSchema,
  ListProfilesRequestSchema,
  SetDefaultProfileRequestSchema,
  UpdateProfileRequestSchema,
} from "@uniffy/proto/settings/v1/settings_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";

const settingsClient = createClient(SettingsService, unaryTransport);

export const settingsApi = {
  createProfile: async (request: MessageInitShape<typeof CreateProfileRequestSchema>) => {
    return settingsClient.createProfile(request);
  },

  getProfile: async (request: MessageInitShape<typeof GetProfileRequestSchema>) => {
    return settingsClient.getProfile(request);
  },

  updateProfile: async (request: MessageInitShape<typeof UpdateProfileRequestSchema>) => {
    return settingsClient.updateProfile(request);
  },

  deleteProfile: async (request: MessageInitShape<typeof DeleteProfileRequestSchema>) => {
    return settingsClient.deleteProfile(request);
  },

  listProfiles: async (request: MessageInitShape<typeof ListProfilesRequestSchema>) => {
    return settingsClient.listProfiles(request);
  },

  getEffectiveSettings: async (
    request: MessageInitShape<typeof GetEffectiveSettingsRequestSchema>,
  ) => {
    return settingsClient.getEffectiveSettings(request);
  },

  getSettingsSchema: async (request: MessageInitShape<typeof GetSettingsSchemaRequestSchema>) => {
    return settingsClient.getSettingsSchema(request);
  },

  setDefaultProfile: async (request: MessageInitShape<typeof SetDefaultProfileRequestSchema>) => {
    return settingsClient.setDefaultProfile(request);
  },
};
