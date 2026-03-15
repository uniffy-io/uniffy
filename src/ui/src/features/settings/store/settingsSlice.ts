/**
 * Settings Redux slice for managing user settings profiles.
 */

import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { SerializedProfile, SerializedEffectiveSettings } from '@/features/settings/store/settingsThunks';
import {
    fetchProfiles,
    fetchEffectiveSettings,
    createProfile,
    updateProfile,
    deleteProfile,
    setDefaultProfile,
} from '@/features/settings/store/settingsThunks';

// ─────────────────────────────────────────────────────────────
// Helper types
// ─────────────────────────────────────────────────────────────

/** DeepPartial makes all nested properties optional */
type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// ─────────────────────────────────────────────────────────────
// State types
// ─────────────────────────────────────────────────────────────

export interface SettingsState {
    // List of user's profiles
    profiles: SerializedProfile[];

    // Currently active profile ID (persisted to localStorage separately)
    activeProfileId: string | null;

    // Effective settings (defaults merged with profile overrides)
    effectiveSettings: SerializedEffectiveSettings | null;

    // Loading states
    loading: boolean;
    saving: boolean;

    // Error state
    error: string | null;

    // Initialization flag
    initialized: boolean;
}

// ─────────────────────────────────────────────────────────────
// Initial state
// ─────────────────────────────────────────────────────────────

const initialState: SettingsState = {
    profiles: [],
    activeProfileId: null,
    effectiveSettings: null,
    loading: false,
    saving: false,
    error: null,
    initialized: false,
};

// ─────────────────────────────────────────────────────────────
// Slice
// ─────────────────────────────────────────────────────────────

const settingsSlice = createSlice({
    name: 'settings',
    initialState,
    reducers: {
        /**
         * Set the active profile ID (e.g., from localStorage).
         */
        setActiveProfileId: (state, action: PayloadAction<string | null>) => {
            state.activeProfileId = action.payload;
        },

        /**
         * Set loading state.
         */
        setLoading: (state, action: PayloadAction<boolean>) => {
            state.loading = action.payload;
        },

        /**
         * Set error state.
         */
        setError: (state, action: PayloadAction<string | null>) => {
            state.error = action.payload;
        },

        /**
         * Clear error state.
         */
        clearError: (state) => {
            state.error = null;
        },

        /**
         * Reset settings state (e.g., on logout).
         */
        resetSettings: () => initialState,

        /**
         * Update effective settings locally (for optimistic updates).
         */
        updateEffectiveSettingsLocal: (
            state,
            action: PayloadAction<DeepPartial<SerializedEffectiveSettings>>
        ) => {
            if (state.effectiveSettings) {
                const payload = action.payload;
                const current = state.effectiveSettings;

                // Merge appearance settings
                if (payload.appearance) {
                    Object.assign(current.appearance, payload.appearance);
                }

                // Merge keyboard shortcuts bindings
                if (payload.keyboardShortcuts?.bindings) {
                    Object.assign(current.keyboardShortcuts.bindings, payload.keyboardShortcuts.bindings);
                }

                // Merge notifications settings
                if (payload.notifications) {
                    Object.assign(current.notifications, payload.notifications);
                }
            }
        },
    },
    extraReducers: (builder) => {
        // ─────────────────────────────────────────────────────────
        // Fetch profiles
        // ─────────────────────────────────────────────────────────
        builder
            .addCase(fetchProfiles.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchProfiles.fulfilled, (state, action) => {
                state.loading = false;
                state.profiles = action.payload;

                // If no active profile set, use the default profile
                if (!state.activeProfileId) {
                    const defaultProfile = action.payload.find(p => p.isDefault);
                    if (defaultProfile) {
                        state.activeProfileId = defaultProfile.id;
                    } else if (action.payload.length > 0) {
                        state.activeProfileId = action.payload[0].id;
                    }
                }
            })
            .addCase(fetchProfiles.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload ?? 'Failed to fetch profiles';
            });

        // ─────────────────────────────────────────────────────────
        // Fetch effective settings
        // ─────────────────────────────────────────────────────────
        builder
            .addCase(fetchEffectiveSettings.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchEffectiveSettings.fulfilled, (state, action) => {
                state.loading = false;
                state.effectiveSettings = action.payload.effectiveSettings;
                state.activeProfileId = action.payload.profile.id;
                state.initialized = true;

                // Update the profile in the profiles list if it exists
                const profileIndex = state.profiles.findIndex(
                    p => p.id === action.payload.profile.id
                );
                if (profileIndex >= 0) {
                    state.profiles[profileIndex] = action.payload.profile;
                } else {
                    state.profiles.push(action.payload.profile);
                }
            })
            .addCase(fetchEffectiveSettings.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload ?? 'Failed to fetch settings';
                state.initialized = true;
            });

        // ─────────────────────────────────────────────────────────
        // Create profile
        // ─────────────────────────────────────────────────────────
        builder
            .addCase(createProfile.pending, (state) => {
                state.saving = true;
                state.error = null;
            })
            .addCase(createProfile.fulfilled, (state, action) => {
                state.saving = false;
                state.profiles.push(action.payload);

                // If this is the new default, update other profiles
                if (action.payload.isDefault) {
                    state.profiles = state.profiles.map(p => ({
                        ...p,
                        isDefault: p.id === action.payload.id,
                    }));
                }
            })
            .addCase(createProfile.rejected, (state, action) => {
                state.saving = false;
                state.error = action.payload ?? 'Failed to create profile';
            });

        // ─────────────────────────────────────────────────────────
        // Update profile
        // ─────────────────────────────────────────────────────────
        builder
            .addCase(updateProfile.pending, (state) => {
                state.saving = true;
                state.error = null;
            })
            .addCase(updateProfile.fulfilled, (state, action) => {
                state.saving = false;

                // Update the profile in the list
                const index = state.profiles.findIndex(p => p.id === action.payload.id);
                if (index >= 0) {
                    state.profiles[index] = action.payload;
                }

                // If this is the new default, update other profiles
                if (action.payload.isDefault) {
                    state.profiles = state.profiles.map(p => ({
                        ...p,
                        isDefault: p.id === action.payload.id,
                    }));
                }
            })
            .addCase(updateProfile.rejected, (state, action) => {
                state.saving = false;
                state.error = action.payload ?? 'Failed to update profile';
            });

        // ─────────────────────────────────────────────────────────
        // Delete profile
        // ─────────────────────────────────────────────────────────
        builder
            .addCase(deleteProfile.pending, (state) => {
                state.saving = true;
                state.error = null;
            })
            .addCase(deleteProfile.fulfilled, (state, action) => {
                state.saving = false;
                state.profiles = state.profiles.filter(p => p.id !== action.payload);

                // If deleted profile was active, switch to default
                if (state.activeProfileId === action.payload) {
                    const defaultProfile = state.profiles.find(p => p.isDefault);
                    state.activeProfileId = defaultProfile?.id ?? state.profiles[0]?.id ?? null;
                }
            })
            .addCase(deleteProfile.rejected, (state, action) => {
                state.saving = false;
                state.error = action.payload ?? 'Failed to delete profile';
            });

        // ─────────────────────────────────────────────────────────
        // Set default profile
        // ─────────────────────────────────────────────────────────
        builder
            .addCase(setDefaultProfile.pending, (state) => {
                state.saving = true;
                state.error = null;
            })
            .addCase(setDefaultProfile.fulfilled, (state, action) => {
                state.saving = false;

                // Update all profiles' default status
                state.profiles = state.profiles.map(p => ({
                    ...p,
                    isDefault: p.id === action.payload.id,
                }));
            })
            .addCase(setDefaultProfile.rejected, (state, action) => {
                state.saving = false;
                state.error = action.payload ?? 'Failed to set default profile';
            });
    },
});

// ─────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────

export const {
    setActiveProfileId,
    setLoading,
    setError,
    clearError,
    resetSettings,
    updateEffectiveSettingsLocal,
} = settingsSlice.actions;

export const settingsReducer = settingsSlice.reducer;

// Re-export thunks for convenience
export {
    fetchProfiles,
    fetchEffectiveSettings,
    createProfile,
    updateProfile,
    deleteProfile,
    setDefaultProfile,
} from '@/features/settings/store/settingsThunks';
