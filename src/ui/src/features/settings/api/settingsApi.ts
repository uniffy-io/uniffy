/**
 * Settings API Service
 *
 * Centralized ConnectRPC client for settings operations.
 * Handles user settings profiles with sparse JSONB storage.
 */

import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { SettingsService } from '@/gen/settings/v1/settings_connect';
import type {
    CreateProfileRequest,
    GetProfileRequest,
    UpdateProfileRequest,
    DeleteProfileRequest,
    ListProfilesRequest,
    GetEffectiveSettingsRequest,
    GetSettingsSchemaRequest,
    SetDefaultProfileRequest,
} from '@/gen/settings/v1/settings_pb';
import type { PartialMessage } from '@bufbuild/protobuf';

/**
 * Create a settings service client with the shared transport.
 */
const settingsClient = createClient(SettingsService, transport);

/**
 * Settings API service with typed methods.
 */
export const settingsApi = {
    /**
     * Create a new settings profile.
     */
    createProfile: async (request: PartialMessage<CreateProfileRequest>) => {
        return settingsClient.createProfile(request);
    },

    /**
     * Get a settings profile by ID.
     */
    getProfile: async (request: PartialMessage<GetProfileRequest>) => {
        return settingsClient.getProfile(request);
    },

    /**
     * Update an existing settings profile (sparse update).
     */
    updateProfile: async (request: PartialMessage<UpdateProfileRequest>) => {
        return settingsClient.updateProfile(request);
    },

    /**
     * Delete a settings profile.
     */
    deleteProfile: async (request: PartialMessage<DeleteProfileRequest>) => {
        return settingsClient.deleteProfile(request);
    },

    /**
     * List all profiles for the current user.
     */
    listProfiles: async (request: PartialMessage<ListProfilesRequest>) => {
        return settingsClient.listProfiles(request);
    },

    /**
     * Get effective settings (defaults merged with profile overrides).
     */
    getEffectiveSettings: async (request: PartialMessage<GetEffectiveSettingsRequest>) => {
        return settingsClient.getEffectiveSettings(request);
    },

    /**
     * Get the schema of available settings with their defaults.
     */
    getSettingsSchema: async (request: PartialMessage<GetSettingsSchemaRequest>) => {
        return settingsClient.getSettingsSchema(request);
    },

    /**
     * Set a profile as the default for the user.
     */
    setDefaultProfile: async (request: PartialMessage<SetDefaultProfileRequest>) => {
        return settingsClient.setDefaultProfile(request);
    },
};

