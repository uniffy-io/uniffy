/**
 * Settings hooks for managing user settings in components.
 */

import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
    fetchEffectiveSettings,
    fetchProfiles,
    updateProfile,
    createProfile,
    deleteProfile,
    setDefaultProfile,
    setActiveProfileId,
    clearError,
    updateEffectiveSettingsLocal,
} from '../store/settingsSlice';
import type { SerializedEffectiveSettings } from '../store/settingsThunks';

// Local storage key for active profile
const ACTIVE_PROFILE_KEY = 'uwos_active_profile_id';

/**
 * Hook for managing settings state and operations.
 *
 * Provides access to profiles, effective settings, and methods
 * for updating settings.
 */
export function useSettings() {
    const dispatch = useAppDispatch();

    // Select state from store
    const profiles = useAppSelector(state => state.settings.profiles);
    const activeProfileId = useAppSelector(state => state.settings.activeProfileId);
    const effectiveSettings = useAppSelector(state => state.settings.effectiveSettings);
    const loading = useAppSelector(state => state.settings.loading);
    const saving = useAppSelector(state => state.settings.saving);
    const error = useAppSelector(state => state.settings.error);
    const initialized = useAppSelector(state => state.settings.initialized);

    // Derived state
    const activeProfile = profiles.find(p => p.id === activeProfileId);
    const hasError = error !== null;

    /**
     * Initialize settings on mount.
     * Loads active profile ID from localStorage and fetches effective settings.
     */
    const initializeSettings = useCallback(async () => {
        // Load active profile from localStorage
        const savedProfileId = localStorage.getItem(ACTIVE_PROFILE_KEY);
        if (savedProfileId) {
            dispatch(setActiveProfileId(savedProfileId));
        }

        // Fetch effective settings (will use saved profile or default)
        await dispatch(fetchEffectiveSettings(savedProfileId || undefined));
        await dispatch(fetchProfiles());
    }, [dispatch]);

    /**
     * Switch to a different profile.
     */
    const switchProfile = useCallback(async (profileId: string) => {
        // Save to localStorage
        localStorage.setItem(ACTIVE_PROFILE_KEY, profileId);

        // Update store and fetch new effective settings
        dispatch(setActiveProfileId(profileId));
        await dispatch(fetchEffectiveSettings(profileId));
    }, [dispatch]);

    /**
     * Update the current profile's settings.
     */
    const updateSettings = useCallback(async (
        updates: {
            appearance?: Partial<SerializedEffectiveSettings['appearance']>;
            keyboardShortcuts?: Partial<SerializedEffectiveSettings['keyboardShortcuts']>;
            notifications?: Partial<SerializedEffectiveSettings['notifications']>;
        }
    ) => {
        if (!activeProfileId) return;

        // Optimistic update
        dispatch(updateEffectiveSettingsLocal(updates));

        // Persist to server
        const result = await dispatch(updateProfile({
            profileId: activeProfileId,
            ...updates,
        }));

        // Refresh effective settings on success
        if (updateProfile.fulfilled.match(result)) {
            await dispatch(fetchEffectiveSettings(activeProfileId));
        }
    }, [dispatch, activeProfileId]);

    /**
     * Create a new profile.
     */
    const createNewProfile = useCallback(async (
        params: {
            name: string;
            appearance?: Partial<SerializedEffectiveSettings['appearance']>;
            keyboardShortcuts?: Partial<SerializedEffectiveSettings['keyboardShortcuts']>;
            notifications?: Partial<SerializedEffectiveSettings['notifications']>;
            isDefault?: boolean;
        }
    ) => {
        const result = await dispatch(createProfile(params));

        if (createProfile.fulfilled.match(result)) {
            // Optionally switch to the new profile
            if (params.isDefault) {
                await switchProfile(result.payload.id);
            }
            return result.payload;
        }
        return null;
    }, [dispatch, switchProfile]);

    /**
     * Delete a profile.
     */
    const removeProfile = useCallback(async (profileId: string) => {
        const result = await dispatch(deleteProfile(profileId));

        if (deleteProfile.fulfilled.match(result)) {
            // If we deleted the active profile, switch to default
            if (profileId === activeProfileId) {
                const defaultProfile = profiles.find(p => p.isDefault && p.id !== profileId);
                if (defaultProfile) {
                    await switchProfile(defaultProfile.id);
                }
            }
            return true;
        }
        return false;
    }, [dispatch, activeProfileId, profiles, switchProfile]);

    /**
     * Set a profile as the default.
     */
    const setDefault = useCallback(async (profileId: string) => {
        const result = await dispatch(setDefaultProfile(profileId));
        return setDefaultProfile.fulfilled.match(result);
    }, [dispatch]);

    /**
     * Clear any error state.
     */
    const dismissError = useCallback(() => {
        dispatch(clearError());
    }, [dispatch]);

    return {
        // State
        profiles,
        activeProfile,
        activeProfileId,
        effectiveSettings,
        loading,
        saving,
        error,
        hasError,
        initialized,

        // Actions
        initializeSettings,
        switchProfile,
        updateSettings,
        createNewProfile,
        removeProfile,
        setDefault,
        dismissError,
    };
}

/**
 * Hook for accessing appearance settings with typed properties.
 */
export function useAppearanceSettings() {
    const effectiveSettings = useAppSelector(state => state.settings.effectiveSettings);

    return {
        theme: effectiveSettings?.appearance.theme ?? 'system',
        accentColor: effectiveSettings?.appearance.accentColor ?? undefined,
        fontFamily: effectiveSettings?.appearance.fontFamily ?? 'inter',
        sidebarCollapsed: effectiveSettings?.appearance.sidebarCollapsed ?? false,
        compactMode: effectiveSettings?.appearance.compactMode ?? false,
        defaultEditor: effectiveSettings?.appearance.defaultEditor ?? 'crepe',
    };
}

/**
 * Hook for accessing notification settings.
 */
export function useNotificationSettings() {
    const effectiveSettings = useAppSelector(state => state.settings.effectiveSettings);

    return {
        desktopEnabled: effectiveSettings?.notifications.desktopEnabled ?? true,
        emailEnabled: effectiveSettings?.notifications.emailEnabled ?? true,
        soundEnabled: effectiveSettings?.notifications.soundEnabled ?? true,
        emailFrequency: effectiveSettings?.notifications.emailFrequency ?? 'instant',
        quietHoursStart: effectiveSettings?.notifications.quietHoursStart ?? undefined,
        quietHoursEnd: effectiveSettings?.notifications.quietHoursEnd ?? undefined,
    };
}
