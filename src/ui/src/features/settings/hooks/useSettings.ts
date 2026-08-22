import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  fetchEffectiveSettings,
  updateSettings as updateSettingsThunk,
  clearError,
  updateEffectiveSettingsLocal,
} from "@/features/settings/store/settingsSlice";
import type { SettingsUpdates } from "@/features/settings/store/settingsThunks";

export function useSettings() {
  const dispatch = useAppDispatch();

  const effectiveSettings = useAppSelector((state) => state.settings.effectiveSettings);
  const loading = useAppSelector((state) => state.settings.loading);
  const saving = useAppSelector((state) => state.settings.saving);
  const error = useAppSelector((state) => state.settings.error);
  const initialized = useAppSelector((state) => state.settings.initialized);

  const hasError = error !== null;

  const initializeSettings = useCallback(async () => {
    await dispatch(fetchEffectiveSettings());
  }, [dispatch]);

  const updateSettings = useCallback(
    async (updates: SettingsUpdates) => {
      dispatch(updateEffectiveSettingsLocal(updates));

      const result = await dispatch(updateSettingsThunk(updates));

      if (updateSettingsThunk.fulfilled.match(result)) {
        await dispatch(fetchEffectiveSettings());
      }
    },
    [dispatch],
  );

  const dismissError = useCallback(() => {
    dispatch(clearError());
  }, [dispatch]);

  return {
    effectiveSettings,
    loading,
    saving,
    error,
    hasError,
    initialized,

    initializeSettings,
    updateSettings,
    dismissError,
  };
}

export function useAppearanceSettings() {
  const effectiveSettings = useAppSelector((state) => state.settings.effectiveSettings);

  return {
    theme: effectiveSettings?.appearance.theme ?? "system",
    accentColor: effectiveSettings?.appearance.accentColor ?? undefined,
    fontFamily: effectiveSettings?.appearance.fontFamily ?? "inter",
    sidebarCollapsed: effectiveSettings?.appearance.sidebarCollapsed ?? false,
    compactMode: effectiveSettings?.appearance.compactMode ?? false,
    defaultEditor: effectiveSettings?.appearance.defaultEditor ?? "crepe",
    mentionDisplay: effectiveSettings?.appearance.mentionDisplay ?? "expanded",
    markdownShowPreview: effectiveSettings?.appearance.markdownShowPreview ?? true,
    markdownShowLineNumbers: effectiveSettings?.appearance.markdownShowLineNumbers ?? true,
    timezone: effectiveSettings?.appearance.timezone ?? "",
    weekStart: effectiveSettings?.appearance.weekStart ?? "monday",
  };
}

export function useNotificationSettings() {
  const effectiveSettings = useAppSelector((state) => state.settings.effectiveSettings);

  return {
    browserEnabled: effectiveSettings?.notifications.browserEnabled ?? true,
    emailEnabled: effectiveSettings?.notifications.emailEnabled ?? true,
    soundEnabled: effectiveSettings?.notifications.soundEnabled ?? true,
    emailFrequency: effectiveSettings?.notifications.emailFrequency ?? "instant",
    emailDigestTime: effectiveSettings?.notifications.emailDigestTime ?? "08:00",
    quietHoursStart: effectiveSettings?.notifications.quietHoursStart ?? undefined,
    quietHoursEnd: effectiveSettings?.notifications.quietHoursEnd ?? undefined,
    channelOverrides: effectiveSettings?.notifications.channelOverrides ?? {},
    defaultReminderIntervals: effectiveSettings?.notifications.defaultReminderIntervals ?? [15],
    toastEnabled: effectiveSettings?.notifications.toastEnabled ?? false,
  };
}
