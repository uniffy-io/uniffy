import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { SerializedEffectiveSettings } from "@/features/settings/store/settingsThunks";
import { fetchEffectiveSettings, updateSettings } from "@/features/settings/store/settingsThunks";

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export interface SettingsState {
  profileId: string | null;
  effectiveSettings: SerializedEffectiveSettings | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  initialized: boolean;
}

const initialState: SettingsState = {
  profileId: null,
  effectiveSettings: null,
  loading: false,
  saving: false,
  error: null,
  initialized: false,
};

const settingsSlice = createSlice({
  name: "settings",
  initialState,
  reducers: {
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
      action: PayloadAction<DeepPartial<SerializedEffectiveSettings>>,
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
      .addCase(fetchEffectiveSettings.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchEffectiveSettings.fulfilled, (state, action) => {
        state.loading = false;
        state.profileId = action.payload.profileId;
        state.effectiveSettings = action.payload.effectiveSettings;
        state.initialized = true;
      })
      .addCase(fetchEffectiveSettings.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? "Failed to fetch settings";
        state.initialized = true;
      });

    builder
      .addCase(updateSettings.pending, (state) => {
        state.saving = true;
        state.error = null;
      })
      .addCase(updateSettings.fulfilled, (state) => {
        state.saving = false;
      })
      .addCase(updateSettings.rejected, (state, action) => {
        state.saving = false;
        state.error = action.payload ?? "Failed to update settings";
      });
  },
});

export const { setLoading, setError, clearError, resetSettings, updateEffectiveSettingsLocal } =
  settingsSlice.actions;

export const settingsReducer = settingsSlice.reducer;

export { fetchEffectiveSettings, updateSettings } from "@/features/settings/store/settingsThunks";
