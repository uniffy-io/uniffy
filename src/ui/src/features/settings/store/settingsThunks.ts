import { createAsyncThunk } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { settingsApi } from "@/features/settings/api/settingsApi";
import type {
  SettingsProfile,
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
  };
};

const keyboardShortcutsToPlain = (shortcuts?: KeyboardShortcutsSettings) => {
  if (!shortcuts) return undefined;
  return {
    bindings: { ...shortcuts.bindings },
  };
};

// Channel-override matrix: per notif-type, which delivery channels (in_app/browser/email) the user opts into.
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
    quietHoursStart: notifications.quietHoursStart || undefined,
    quietHoursEnd: notifications.quietHoursEnd || undefined,
    channelOverrides,
    defaultReminderIntervals: notifications.defaultReminderIntervals?.length
      ? [...notifications.defaultReminderIntervals]
      : [15],
    toastEnabled: notifications.toastEnabled,
  };
};

const profileToPlain = (profile: SettingsProfile) => ({
  id: profile.id,
  userId: profile.userId,
  name: profile.name,
  isDefault: profile.isDefault,
  appearance: appearanceToPlain(profile.appearance),
  keyboardShortcuts: keyboardShortcutsToPlain(profile.keyboardShortcuts),
  notifications: notificationsToPlain(profile.notifications),
  createdAt: profile.createdAt ? timestampDate(profile.createdAt).toISOString() : undefined,
  updatedAt: profile.updatedAt ? timestampDate(profile.updatedAt).toISOString() : undefined,
});

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
  },
  keyboardShortcuts: keyboardShortcutsToPlain(settings.keyboardShortcuts) ?? {
    bindings: {},
  },
  notifications: notificationsToPlain(settings.notifications) ?? {
    browserEnabled: true,
    emailEnabled: true,
    soundEnabled: true,
    emailFrequency: "instant",
    quietHoursStart: undefined,
    quietHoursEnd: undefined,
    channelOverrides: {} as Record<string, Record<string, boolean>>,
    defaultReminderIntervals: [15],
    toastEnabled: false,
  },
});

export type SerializedProfile = ReturnType<typeof profileToPlain>;
export type SerializedEffectiveSettings = ReturnType<typeof effectiveSettingsToPlain>;

export const fetchProfiles = createAsyncThunk<
  SerializedProfile[],
  void,
  { state: RootState; rejectValue: string }
>("settings/fetchProfiles", async (_, { rejectWithValue }) => {
  try {
    const response = await settingsApi.listProfiles({});
    return response.profiles.map(profileToPlain);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch profiles");
  }
});

export const fetchEffectiveSettings = createAsyncThunk<
  { profile: SerializedProfile; effectiveSettings: SerializedEffectiveSettings },
  string | undefined,
  { state: RootState; rejectValue: string }
>("settings/fetchEffectiveSettings", async (profileId, { rejectWithValue }) => {
  try {
    const response = await settingsApi.getEffectiveSettings({
      profileId: profileId,
    });

    if (!response.profile || !response.effectiveSettings) {
      return rejectWithValue("Invalid response from server");
    }

    return {
      profile: profileToPlain(response.profile),
      effectiveSettings: effectiveSettingsToPlain(response.effectiveSettings),
    };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch settings");
  }
});

export const createProfile = createAsyncThunk<
  SerializedProfile,
  {
    name: string;
    appearance?: Partial<SerializedEffectiveSettings["appearance"]>;
    keyboardShortcuts?: Partial<SerializedEffectiveSettings["keyboardShortcuts"]>;
    notifications?: Partial<SerializedEffectiveSettings["notifications"]>;
    isDefault?: boolean;
  },
  { state: RootState; rejectValue: string }
>("settings/createProfile", async (params, { rejectWithValue }) => {
  try {
    const response = await settingsApi.createProfile({
      name: params.name,
      appearance: params.appearance,
      keyboardShortcuts: params.keyboardShortcuts
        ? {
            bindings: params.keyboardShortcuts.bindings,
          }
        : undefined,
      notifications: params.notifications,
      isDefault: params.isDefault ?? false,
    });

    if (!response.profile) {
      return rejectWithValue("Failed to create profile");
    }

    return profileToPlain(response.profile);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to create profile");
  }
});

export const updateProfile = createAsyncThunk<
  SerializedProfile,
  {
    profileId: string;
    name?: string;
    appearance?: Partial<SerializedEffectiveSettings["appearance"]>;
    keyboardShortcuts?: Partial<SerializedEffectiveSettings["keyboardShortcuts"]>;
    notifications?: Partial<SerializedEffectiveSettings["notifications"]>;
    isDefault?: boolean;
  },
  { state: RootState; rejectValue: string }
>("settings/updateProfile", async (params, { rejectWithValue }) => {
  try {
    const response = await settingsApi.updateProfile({
      profileId: params.profileId,
      name: params.name,
      appearance: params.appearance,
      keyboardShortcuts: params.keyboardShortcuts
        ? {
            bindings: params.keyboardShortcuts.bindings,
          }
        : undefined,
      notifications: params.notifications,
      isDefault: params.isDefault,
    });

    if (!response.profile) {
      return rejectWithValue("Failed to update profile");
    }

    return profileToPlain(response.profile);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to update profile");
  }
});

export const deleteProfile = createAsyncThunk<
  string,
  string,
  { state: RootState; rejectValue: string }
>("settings/deleteProfile", async (profileId, { rejectWithValue }) => {
  try {
    const response = await settingsApi.deleteProfile({ profileId });

    if (!response.success) {
      return rejectWithValue(response.message || "Failed to delete profile");
    }

    return profileId;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to delete profile");
  }
});

export const setDefaultProfile = createAsyncThunk<
  SerializedProfile,
  string,
  { state: RootState; rejectValue: string }
>("settings/setDefaultProfile", async (profileId, { rejectWithValue }) => {
  try {
    const response = await settingsApi.setDefaultProfile({ profileId });

    if (!response.profile) {
      return rejectWithValue("Failed to set default profile");
    }

    return profileToPlain(response.profile);
  } catch (error) {
    return rejectWithValue(
      error instanceof Error ? error.message : "Failed to set default profile",
    );
  }
});
