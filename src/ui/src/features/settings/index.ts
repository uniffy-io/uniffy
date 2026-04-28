/**
 * Settings feature exports.
 */

export { settingsApi } from '@/features/settings/api/settingsApi';

// Components
export { SettingsLayout } from '@/features/settings/components/SettingsLayout';
export type { SettingsSection } from '@/features/settings/components/SettingsLayout';
export { ProfileSwitcher } from '@/features/settings/components/ProfileSwitcher';
export { AppearanceSection } from '@/features/settings/components/AppearanceSection';
export { KeyboardShortcutsSection } from '@/features/settings/components/KeyboardShortcutsSection';
export { NotificationsSection } from '@/features/settings/components/NotificationsSection';
export { AccountSection } from '@/features/settings/components/AccountSection';
export { SessionsSection } from '@/features/settings/components/SessionsSection';

// Sessions API
export { sessionsApi } from '@/features/settings/api/sessionsApi';

// Pages
export { SettingsPage } from '@/features/settings/pages/SettingsPage';

// Store - Slice & Actions
export {
    settingsReducer,
    setActiveProfileId,
    setLoading,
    setError,
    clearError,
    resetSettings,
    updateEffectiveSettingsLocal,
} from '@/features/settings/store/settingsSlice';

// Store - Thunks
export {
    fetchProfiles,
    fetchEffectiveSettings,
    createProfile,
    updateProfile,
    deleteProfile,
    setDefaultProfile,
} from '@/features/settings/store/settingsSlice';

// Store - Types
export type { SettingsState } from '@/features/settings/store/settingsSlice';
export type { SerializedProfile, SerializedEffectiveSettings } from '@/features/settings/store/settingsThunks';

// Hooks - Settings
export {
    useSettings,
    useAppearanceSettings,
    useNotificationSettings,
} from '@/features/settings/hooks/useSettings';

// Hooks - Keyboard Shortcuts
export {
    useKeyboardBindings,
    useKeybinding,
    useFormattedKeybinding,
    useShortcutHandler,
    useShortcutHandlers,
    useGlobalShortcuts,
    formatShortcut,
    matchesShortcut,
} from '@/features/settings/hooks/useKeyboardShortcuts';
