import { createAsyncThunk } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import { agentRuntimeSettingsApi } from "@/features/admin/api/agentRuntimeSettingsApi";
import type { RuntimeSettings } from "@uniffy/proto/agents/v1/runtime_pb";

export interface RuntimeSettingsPlain {
  sendDeadlineSeconds: number;
  failoverEnabled: boolean;
  resumeEnabled: boolean;
  circuitBreakerFailureThreshold: number;
  circuitBreakerRecoverySeconds: number;
  personalMemoryBridgeEnabled: boolean;
  defaultProviderKeyId: string;
  defaultChatModel: string;
  imageMaxResolution: string;
  imageMaxQuality: string;
}

export interface RuntimeSettingsResult {
  settings: RuntimeSettingsPlain;
  configured: boolean;
}

const toPlain = (s: RuntimeSettings): RuntimeSettingsPlain => ({
  sendDeadlineSeconds: s.sendDeadlineSeconds,
  failoverEnabled: s.failoverEnabled,
  resumeEnabled: s.resumeEnabled,
  circuitBreakerFailureThreshold: s.circuitBreakerFailureThreshold,
  circuitBreakerRecoverySeconds: s.circuitBreakerRecoverySeconds,
  personalMemoryBridgeEnabled: s.personalMemoryBridgeEnabled,
  defaultProviderKeyId: s.defaultProviderKeyId,
  defaultChatModel: s.defaultChatModel,
  imageMaxResolution: s.imageMaxResolution,
  imageMaxQuality: s.imageMaxQuality,
});

export const fetchRuntimeSettings = createAsyncThunk<
  RuntimeSettingsResult,
  void,
  { state: RootState; rejectValue: string }
>("agentRuntimeSettings/fetch", async (_, { getState, rejectWithValue }) => {
  const organizationId = getState().auth.currentOrganizationId;
  if (!organizationId) return rejectWithValue("No organization selected");
  try {
    const response = await agentRuntimeSettingsApi.getRuntimeSettings({ organizationId });
    if (!response.settings) throw new Error("No settings in response");
    return { settings: toPlain(response.settings), configured: response.configured };
  } catch (err) {
    return rejectWithValue(err instanceof Error ? err.message : "Failed to load runtime settings");
  }
});

export const saveRuntimeSettings = createAsyncThunk<
  RuntimeSettingsResult,
  RuntimeSettingsPlain,
  { state: RootState; rejectValue: string }
>("agentRuntimeSettings/save", async (settings, { getState, rejectWithValue }) => {
  const organizationId = getState().auth.currentOrganizationId;
  if (!organizationId) return rejectWithValue("No organization selected");
  try {
    const response = await agentRuntimeSettingsApi.updateRuntimeSettings({
      organizationId,
      settings: {
        sendDeadlineSeconds: settings.sendDeadlineSeconds,
        failoverEnabled: settings.failoverEnabled,
        resumeEnabled: settings.resumeEnabled,
        circuitBreakerFailureThreshold: settings.circuitBreakerFailureThreshold,
        circuitBreakerRecoverySeconds: settings.circuitBreakerRecoverySeconds,
        personalMemoryBridgeEnabled: settings.personalMemoryBridgeEnabled,
        defaultProviderKeyId: settings.defaultProviderKeyId,
        defaultChatModel: settings.defaultChatModel,
        imageMaxResolution: settings.imageMaxResolution,
        imageMaxQuality: settings.imageMaxQuality,
      },
    });
    if (!response.settings) throw new Error("No settings in response");
    return { settings: toPlain(response.settings), configured: response.configured };
  } catch (err) {
    return rejectWithValue(err instanceof Error ? err.message : "Failed to save runtime settings");
  }
});
