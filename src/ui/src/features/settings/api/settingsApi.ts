/**
 * Settings API Service
 *
 * Centralized ConnectRPC client for settings operations.
 * Handles user settings profiles with sparse JSONB storage.
 */

import { createClient } from '@connectrpc/connect';
import { unaryTransport } from '@/config/api';
import { SettingsService, CreateProfileRequestSchema, DeleteProfileRequestSchema, GetEffectiveSettingsRequestSchema, GetProfileRequestSchema, GetSettingsSchemaRequestSchema, ListProfilesRequestSchema, SetDefaultProfileRequestSchema, UpdateProfileRequestSchema } from '@uniffy/proto/settings/v1/settings_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

/**
 * Create a settings service client with the shared transport.
 */
const settingsClient = createClient(SettingsService, unaryTransport);

/**
 * Settings API service with typed methods.
 */
export const settingsApi = {
    /**
     * Create a new settings profile.
     */
    createProfile: async (request: MessageInitShape<typeof CreateProfileRequestSchema>) => {
        return settingsClient.createProfile(request);
    },

    /**
     * Get a settings profile by ID.
     */
    getProfile: async (request: MessageInitShape<typeof GetProfileRequestSchema>) => {
        return settingsClient.getProfile(request);
    },

    /**
     * Update an existing settings profile (sparse update).
     */
    updateProfile: async (request: MessageInitShape<typeof UpdateProfileRequestSchema>) => {
        return settingsClient.updateProfile(request);
    },

    /**
     * Delete a settings profile.
     */
    deleteProfile: async (request: MessageInitShape<typeof DeleteProfileRequestSchema>) => {
        return settingsClient.deleteProfile(request);
    },

    /**
     * List all profiles for the current user.
     */
    listProfiles: async (request: MessageInitShape<typeof ListProfilesRequestSchema>) => {
        return settingsClient.listProfiles(request);
    },

    /**
     * Get effective settings (defaults merged with profile overrides).
     */
    getEffectiveSettings: async (request: MessageInitShape<typeof GetEffectiveSettingsRequestSchema>) => {
        return settingsClient.getEffectiveSettings(request);
    },

    /**
     * Get the schema of available settings with their defaults.
     */
    getSettingsSchema: async (request: MessageInitShape<typeof GetSettingsSchemaRequestSchema>) => {
        return settingsClient.getSettingsSchema(request);
    },

    /**
     * Set a profile as the default for the user.
     */
    setDefaultProfile: async (request: MessageInitShape<typeof SetDefaultProfileRequestSchema>) => {
        return settingsClient.setDefaultProfile(request);
    },
};

