import { createAsyncThunk } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import { settingsApi } from "@/features/settings/api/settingsApi";
import type {
  EffectiveSettings,
  AppearanceSettings,
  KeyboardShortcutsSettings,
  NotificationsSettings,
} from "@uniffy/proto/settings/v1/settings_pb";

const appearanceToPlain = (appearance?: AppearanceSettings) => {
  if (!appearance) return undefined;
  return {
    theme: appearance.theme || undefined,
    accentColor: appearance.accentColor || undefined,
    fontFamily: appearance.fontFamily || undefined,
    sidebarCollapsed: appearance.sidebarCollapsed,
    compactMode: appearance.compactMode,
    defaultEditor: appearance.defaultEditor || undefined,
    mentionDisplay: appearance.mentionDisplay || undefined,
    markdownShowPreview: appearance.markdownShowPreview,
    markdownShowLineNumbers: appearance.markdownShowLineNumbers,
    timezone: appearance.timezone || undefined,
    weekStart: appearance.weekStart || undefined,
  };
};

const keyboardShortcutsToPlain = (shortcuts?: KeyboardShortcutsSettings) => {
  if (!shortcuts) return undefined;
  return {
    bindings: { ...shortcuts.bindings },
  };
};

const notificationsToPlain = (notifications?: NotificationsSettings) => {
  if (!notifications) return undefined;

  const channelOverrides: Record<string, Record<string, boolean>> = {};
  if (notifications.channelOverrides) {
    for (const [notifType, pref] of Object.entries(notifications.channelOverrides)) {
      const channels: Record<string, boolean> = {};
      if (pref.inApp !== undefined) channels.in_app = pref.inApp;
      if (pref.browser !== undefined) channels.browser = pref.browser;
      if (pref.email !== undefined) channels.email = pref.email;
      if (Object.keys(channels).length > 0) {
        channelOverrides[notifType] = channels;
      }
    }
  }

  return {
    browserEnabled: notifications.browserEnabled,
    emailEnabled: notifications.emailEnabled,
    soundEnabled: notifications.soundEnabled,
    emailFrequency: notifications.emailFrequency || undefined,
    emailDigestTime: notifications.emailDigestTime || undefined,
    quietHoursStart: notifications.quietHoursStart || undefined,
    quietHoursEnd: notifications.quietHoursEnd || undefined,
    channelOverrides,
    defaultReminderIntervals: notifications.defaultReminderIntervals?.length
      ? [...notifications.defaultReminderIntervals]
      : [15],
    toastEnabled: notifications.toastEnabled,
  };
};

const effectiveSettingsToPlain = (settings: EffectiveSettings) => ({
  appearance: appearanceToPlain(settings.appearance) ?? {
    theme: "system",
    accentColor: undefined,
    fontFamily: "inter",
    sidebarCollapsed: false,
    compactMode: false,
    defaultEditor: "crepe",
    mentionDisplay: "expanded",
    markdownShowPreview: true,
    markdownShowLineNumbers: true,
    timezone: undefined,
    weekStart: "monday",
  },
  keyboardShortcuts: keyboardShortcutsToPlain(settings.keyboardShortcuts) ?? {
    bindings: {},
  },
  notifications: notificationsToPlain(settings.notifications) ?? {
    browserEnabled: true,
    emailEnabled: true,
    soundEnabled: true,
    emailFrequency: "instant",
    emailDigestTime: "08:00",
    quietHoursStart: undefined,
    quietHoursEnd: undefined,
    channelOverrides: {} as Record<string, Record<string, boolean>>,
    defaultReminderIntervals: [15],
    toastEnabled: false,
  },
});

export type SerializedEffectiveSettings = ReturnType<typeof effectiveSettingsToPlain>;

export interface SettingsUpdates {
  appearance?: Partial<SerializedEffectiveSettings["appearance"]>;
  keyboardShortcuts?: Partial<SerializedEffectiveSettings["keyboardShortcuts"]>;
  notifications?: Partial<SerializedEffectiveSettings["notifications"]>;
}

export const fetchEffectiveSettings = createAsyncThunk<
  { profileId: string; effectiveSettings: SerializedEffectiveSettings },
  void,
  { state: RootState; rejectValue: string }
>("settings/fetchEffectiveSettings", async (_, { rejectWithValue }) => {
  try {
    const response = await settingsApi.getEffectiveSettings({});

    if (!response.profile || !response.effectiveSettings) {
      return rejectWithValue("Invalid response from server");
    }

    return {
      profileId: response.profile.id,
      effectiveSettings: effectiveSettingsToPlain(response.effectiveSettings),
    };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch settings");
  }
});

export const updateSettings = createAsyncThunk<
  void,
  SettingsUpdates,
  { state: RootState; rejectValue: string }
>("settings/updateSettings", async (updates, { getState, rejectWithValue }) => {
  const profileId = getState().settings.profileId;
  if (!profileId) {
    return rejectWithValue("Settings are not loaded yet");
  }

  try {
    const response = await settingsApi.updateProfile({
      profileId,
      appearance: updates.appearance,
      keyboardShortcuts: updates.keyboardShortcuts
        ? {
            bindings: updates.keyboardShortcuts.bindings,
          }
        : undefined,
      notifications: updates.notifications,
    });

    if (!response.profile) {
      return rejectWithValue("Failed to update settings");
    }
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to update settings");
  }
});
