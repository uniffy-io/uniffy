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

type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export interface SettingsState {
    profiles: SerializedProfile[];
    activeProfileId: string | null;
    effectiveSettings: SerializedEffectiveSettings | null;
    loading: boolean;
    saving: boolean;
    error: string | null;
    initialized: boolean;
}

const initialState: SettingsState = {
    profiles: [],
    activeProfileId: null,
    effectiveSettings: null,
    loading: false,
    saving: false,
    error: null,
    initialized: false,
};

const settingsSlice = createSlice({
    name: 'settings',
    initialState,
    reducers: {
        setActiveProfileId: (state, action: PayloadAction<string | null>) => {
            state.activeProfileId = action.payload;
        },

        setLoading: (state, action: PayloadAction<boolean>) => {
            state.loading = action.payload;
        },

        setError: (state, action: PayloadAction<string | null>) => {
            state.error = action.payload;
        },

        clearError: (state) => {
            state.error = null;
        },

        resetSettings: () => initialState,

        updateEffectiveSettingsLocal: (
            state,
            action: PayloadAction<DeepPartial<SerializedEffectiveSettings>>
        ) => {
            if (state.effectiveSettings) {
                const payload = action.payload;
                const current = state.effectiveSettings;

                if (payload.appearance) {
                    Object.assign(current.appearance, payload.appearance);
                }

                if (payload.keyboardShortcuts?.bindings) {
                    Object.assign(current.keyboardShortcuts.bindings, payload.keyboardShortcuts.bindings);
                }

                if (payload.notifications) {
                    Object.assign(current.notifications, payload.notifications);
                }
            }
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchProfiles.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchProfiles.fulfilled, (state, action) => {
                state.loading = false;
                state.profiles = action.payload;

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

        builder
            .addCase(createProfile.pending, (state) => {
                state.saving = true;
                state.error = null;
            })
            .addCase(createProfile.fulfilled, (state, action) => {
                state.saving = false;
                state.profiles.push(action.payload);

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

        builder
            .addCase(updateProfile.pending, (state) => {
                state.saving = true;
                state.error = null;
            })
            .addCase(updateProfile.fulfilled, (state, action) => {
                state.saving = false;

                const index = state.profiles.findIndex(p => p.id === action.payload.id);
                if (index >= 0) {
                    state.profiles[index] = action.payload;
                }

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

        builder
            .addCase(deleteProfile.pending, (state) => {
                state.saving = true;
                state.error = null;
            })
            .addCase(deleteProfile.fulfilled, (state, action) => {
                state.saving = false;
                state.profiles = state.profiles.filter(p => p.id !== action.payload);

                if (state.activeProfileId === action.payload) {
                    const defaultProfile = state.profiles.find(p => p.isDefault);
                    state.activeProfileId = defaultProfile?.id ?? state.profiles[0]?.id ?? null;
                }
            })
            .addCase(deleteProfile.rejected, (state, action) => {
                state.saving = false;
                state.error = action.payload ?? 'Failed to delete profile';
            });

        builder
            .addCase(setDefaultProfile.pending, (state) => {
                state.saving = true;
                state.error = null;
            })
            .addCase(setDefaultProfile.fulfilled, (state, action) => {
                state.saving = false;

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

export const {
    setActiveProfileId,
    setLoading,
    setError,
    clearError,
    resetSettings,
    updateEffectiveSettingsLocal,
} = settingsSlice.actions;

export const settingsReducer = settingsSlice.reducer;

export {
    fetchProfiles,
    fetchEffectiveSettings,
    createProfile,
    updateProfile,
    deleteProfile,
    setDefaultProfile,
} from '@/features/settings/store/settingsThunks';
