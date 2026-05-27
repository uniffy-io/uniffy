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
} from '@/features/settings/store/settingsSlice';
import type { SerializedEffectiveSettings } from '@/features/settings/store/settingsThunks';

const ACTIVE_PROFILE_KEY = 'uniffy_active_profile_id';

export function useSettings() {
    const dispatch = useAppDispatch();

    const profiles = useAppSelector(state => state.settings.profiles);
    const activeProfileId = useAppSelector(state => state.settings.activeProfileId);
    const effectiveSettings = useAppSelector(state => state.settings.effectiveSettings);
    const loading = useAppSelector(state => state.settings.loading);
    const saving = useAppSelector(state => state.settings.saving);
    const error = useAppSelector(state => state.settings.error);
    const initialized = useAppSelector(state => state.settings.initialized);

    const activeProfile = profiles.find(p => p.id === activeProfileId);
    const hasError = error !== null;

    const initializeSettings = useCallback(async () => {
        const savedProfileId = localStorage.getItem(ACTIVE_PROFILE_KEY);
        if (savedProfileId) {
            dispatch(setActiveProfileId(savedProfileId));
        }

        await dispatch(fetchEffectiveSettings(savedProfileId || undefined));
        await dispatch(fetchProfiles());
    }, [dispatch]);

    const switchProfile = useCallback(async (profileId: string) => {
        localStorage.setItem(ACTIVE_PROFILE_KEY, profileId);

        dispatch(setActiveProfileId(profileId));
        await dispatch(fetchEffectiveSettings(profileId));
    }, [dispatch]);

    const updateSettings = useCallback(async (
        updates: {
            appearance?: Partial<SerializedEffectiveSettings['appearance']>;
            keyboardShortcuts?: Partial<SerializedEffectiveSettings['keyboardShortcuts']>;
            notifications?: Partial<SerializedEffectiveSettings['notifications']>;
        }
    ) => {
        if (!activeProfileId) return;

        dispatch(updateEffectiveSettingsLocal(updates));

        const result = await dispatch(updateProfile({
            profileId: activeProfileId,
            ...updates,
        }));

        if (updateProfile.fulfilled.match(result)) {
            await dispatch(fetchEffectiveSettings(activeProfileId));
        }
    }, [dispatch, activeProfileId]);

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
            if (params.isDefault) {
                await switchProfile(result.payload.id);
            }
            return result.payload;
        }
        return null;
    }, [dispatch, switchProfile]);

    const removeProfile = useCallback(async (profileId: string) => {
        const result = await dispatch(deleteProfile(profileId));

        if (deleteProfile.fulfilled.match(result)) {
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

    const setDefault = useCallback(async (profileId: string) => {
        const result = await dispatch(setDefaultProfile(profileId));
        return setDefaultProfile.fulfilled.match(result);
    }, [dispatch]);

    const dismissError = useCallback(() => {
        dispatch(clearError());
    }, [dispatch]);

    return {
        profiles,
        activeProfile,
        activeProfileId,
        effectiveSettings,
        loading,
        saving,
        error,
        hasError,
        initialized,

        initializeSettings,
        switchProfile,
        updateSettings,
        createNewProfile,
        removeProfile,
        setDefault,
        dismissError,
    };
}

export function useAppearanceSettings() {
    const effectiveSettings = useAppSelector(state => state.settings.effectiveSettings);

    return {
        theme: effectiveSettings?.appearance.theme ?? 'system',
        accentColor: effectiveSettings?.appearance.accentColor ?? undefined,
        fontFamily: effectiveSettings?.appearance.fontFamily ?? 'inter',
        sidebarCollapsed: effectiveSettings?.appearance.sidebarCollapsed ?? false,
        compactMode: effectiveSettings?.appearance.compactMode ?? false,
        defaultEditor: effectiveSettings?.appearance.defaultEditor ?? 'crepe',
        mentionDisplay: effectiveSettings?.appearance.mentionDisplay ?? 'expanded',
        markdownShowPreview: effectiveSettings?.appearance.markdownShowPreview ?? true,
        markdownShowLineNumbers: effectiveSettings?.appearance.markdownShowLineNumbers ?? true,
    };
}

export function useNotificationSettings() {
    const effectiveSettings = useAppSelector(state => state.settings.effectiveSettings);

    return {
        browserEnabled: effectiveSettings?.notifications.browserEnabled ?? true,
        emailEnabled: effectiveSettings?.notifications.emailEnabled ?? true,
        soundEnabled: effectiveSettings?.notifications.soundEnabled ?? true,
        emailFrequency: effectiveSettings?.notifications.emailFrequency ?? 'instant',
        quietHoursStart: effectiveSettings?.notifications.quietHoursStart ?? undefined,
        quietHoursEnd: effectiveSettings?.notifications.quietHoursEnd ?? undefined,
        channelOverrides: effectiveSettings?.notifications.channelOverrides ?? {},
        defaultReminderIntervals: effectiveSettings?.notifications.defaultReminderIntervals ?? [15],
        toastEnabled: effectiveSettings?.notifications.toastEnabled ?? false,
    };
}
