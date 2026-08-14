export { settingsApi } from "@/features/settings/api/settingsApi";

export { SettingsLayout } from "@/features/settings/components/SettingsLayout";
export type { SettingsSection } from "@/features/settings/components/SettingsLayout";
export { ProfileSwitcher } from "@/features/settings/components/ProfileSwitcher";
export { AppearanceSection } from "@/features/settings/components/AppearanceSection";
export { KeyboardShortcutsSection } from "@/features/settings/components/KeyboardShortcutsSection";
export { NotificationsSection } from "@/features/settings/components/NotificationsSection";
export { AccountSection } from "@/features/settings/components/AccountSection";
export { SessionsSection } from "@/features/settings/components/SessionsSection";

export { sessionsApi } from "@/features/settings/api/sessionsApi";

export { SettingsPage } from "@/features/settings/pages/SettingsPage";

export {
  settingsReducer,
  setActiveProfileId,
  setLoading,
  setError,
  clearError,
  resetSettings,
  updateEffectiveSettingsLocal,
} from "@/features/settings/store/settingsSlice";

export {
  fetchProfiles,
  fetchEffectiveSettings,
  createProfile,
  updateProfile,
  deleteProfile,
  setDefaultProfile,
} from "@/features/settings/store/settingsSlice";

export type { SettingsState } from "@/features/settings/store/settingsSlice";
export type {
  SerializedProfile,
  SerializedEffectiveSettings,
} from "@/features/settings/store/settingsThunks";

export {
  useSettings,
  useAppearanceSettings,
  useNotificationSettings,
} from "@/features/settings/hooks/useSettings";

export {
  useKeyboardBindings,
  useKeybinding,
  useFormattedKeybinding,
  useShortcutHandler,
  useShortcutHandlers,
  useGlobalShortcuts,
  formatShortcut,
  matchesShortcut,
} from "@/features/settings/hooks/useKeyboardShortcuts";
