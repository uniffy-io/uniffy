/**
 * Settings feature exports.
 */

// API
export { settingsApi } from './api/settingsApi';

// Components
export { SettingsLayout } from './components/SettingsLayout';
export type { SettingsSection } from './components/SettingsLayout';
export { ProfileSwitcher } from './components/ProfileSwitcher';
export { AppearanceSection } from './components/AppearanceSection';
export { KeyboardShortcutsSection } from './components/KeyboardShortcutsSection';
export { NotificationsSection } from './components/NotificationsSection';
export { AccountSection } from './components/AccountSection';

// Pages
export { SettingsPage, default as SettingsPageDefault } from './pages/SettingsPage';

// Store - Slice & Actions
export {
    default as settingsReducer,
    setActiveProfileId,
    setLoading,
    setError,
    clearError,
    resetSettings,
    updateEffectiveSettingsLocal,
} from './store/settingsSlice';

// Store - Thunks
export {
    fetchProfiles,
    fetchEffectiveSettings,
    createProfile,
    updateProfile,
    deleteProfile,
    setDefaultProfile,
} from './store/settingsSlice';

// Store - Types
export type { SettingsState } from './store/settingsSlice';
export type { SerializedProfile, SerializedEffectiveSettings } from './store/settingsThunks';

// Hooks - Settings
export {
    useSettings,
    useAppearanceSettings,
    useNotificationSettings,
} from './hooks/useSettings';

// Hooks - Keyboard Shortcuts
export {
    useKeyboardBindings,
    useKeybinding,
    useFormattedKeybinding,
    useShortcutHandler,
    useShortcutHandlers,
    useGlobalShortcuts,
    formatShortcut,
} from './hooks/useKeyboardShortcuts';
