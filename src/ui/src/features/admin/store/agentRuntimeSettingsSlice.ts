import { createSlice } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import {
  fetchRuntimeSettings,
  saveRuntimeSettings,
  type RuntimeSettingsPlain,
} from "@/features/admin/store/agentRuntimeSettingsThunks";

interface AgentRuntimeSettingsState {
  settings: RuntimeSettingsPlain | null;
  configured: boolean;
  loading: boolean;
  saving: boolean;
}

const initialState: AgentRuntimeSettingsState = {
  settings: null,
  configured: false,
  loading: false,
  saving: false,
};

export const agentRuntimeSettingsSlice = createSlice({
  name: "agentRuntimeSettings",
  initialState,
  reducers: {
    clearAgentRuntimeSettings: () => initialState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchRuntimeSettings.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchRuntimeSettings.fulfilled, (state, action) => {
        state.loading = false;
        state.settings = action.payload.settings;
        state.configured = action.payload.configured;
      })
      .addCase(fetchRuntimeSettings.rejected, (state) => {
        state.loading = false;
      })
      .addCase(saveRuntimeSettings.pending, (state) => {
        state.saving = true;
      })
      .addCase(saveRuntimeSettings.fulfilled, (state, action) => {
        state.saving = false;
        state.settings = action.payload.settings;
        state.configured = action.payload.configured;
      })
      .addCase(saveRuntimeSettings.rejected, (state) => {
        state.saving = false;
      });
  },
});

export const { clearAgentRuntimeSettings } = agentRuntimeSettingsSlice.actions;
export const agentRuntimeSettingsReducer = agentRuntimeSettingsSlice.reducer;

export const selectRuntimeSettings = (state: RootState) => state.agentRuntimeSettings.settings;
export const selectRuntimeSettingsConfigured = (state: RootState) =>
  state.agentRuntimeSettings.configured;
export const selectRuntimeSettingsLoading = (state: RootState) =>
  state.agentRuntimeSettings.loading;
export const selectRuntimeSettingsSaving = (state: RootState) => state.agentRuntimeSettings.saving;
