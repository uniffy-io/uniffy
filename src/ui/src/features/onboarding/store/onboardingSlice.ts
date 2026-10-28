import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import {
  fetchOnboarding,
  finishOnboarding,
  recordOnboardingStep,
} from "@/features/onboarding/store/onboardingThunks";
import type { OnboardingStepId } from "@/features/onboarding/steps";

export interface OrganizationOnboarding {
  pending: boolean;
  currentStep: OnboardingStepId;
}

export interface OnboardingState {
  /** Keyed by organization, so a tab that switches never reads another tenant's answer. */
  byOrganization: Record<string, OrganizationOnboarding>;
  /** Organizations whose state is in flight or could not be read this session. */
  settled: Record<string, "loading" | "failed">;
}

const initialState: OnboardingState = {
  byOrganization: {},
  settled: {},
};

export const onboardingSlice = createSlice({
  name: "onboarding",
  initialState,
  reducers: {
    /** Moves the screen locally so navigation never waits on the step record round trip. */
    onboardingStepShown(
      state,
      action: PayloadAction<{ organizationId: string; step: OnboardingStepId }>,
    ) {
      const entry = state.byOrganization[action.payload.organizationId];
      if (entry) entry.currentStep = action.payload.step;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchOnboarding.pending, (state, action) => {
        state.settled[action.meta.arg] = "loading";
      })
      .addCase(fetchOnboarding.fulfilled, (state, action) => {
        state.byOrganization[action.meta.arg] = action.payload;
        delete state.settled[action.meta.arg];
      })
      .addCase(fetchOnboarding.rejected, (state, action) => {
        if (action.meta.condition) return;
        state.settled[action.meta.arg] = "failed";
      })
      .addCase(recordOnboardingStep.fulfilled, (state, action) => {
        const entry = state.byOrganization[action.meta.arg.organizationId];
        if (entry && !action.payload.pending) entry.pending = false;
      })
      .addCase(finishOnboarding.fulfilled, (state, action) => {
        state.byOrganization[action.meta.arg.organizationId] = action.payload;
      });
  },
});

export const { onboardingStepShown } = onboardingSlice.actions;
export const onboardingReducer = onboardingSlice.reducer;

export const selectOnboardingFor = (state: RootState, organizationId: string | null) =>
  organizationId ? (state.onboarding.byOrganization[organizationId] ?? null) : null;

export const selectOnboardingSettled = (state: RootState, organizationId: string | null) =>
  organizationId ? (state.onboarding.settled[organizationId] ?? null) : null;

export const selectOnboardingProviderKey = (state: RootState) => {
  if (state.agentProviders.organizationId !== state.auth.currentOrganizationId) return null;
  const keys = state.agentProviders.providerKeys;
  const configuredKey = keys[state.agentRuntimeSettings.settings?.defaultProviderKeyId ?? ""];
  if (configuredKey?.isEnabled && configuredKey.isValid) return configuredKey;
  return Object.values(keys).find((entry) => entry.isEnabled && entry.isValid) ?? null;
};

export const selectConfiguredProvider = (state: RootState): string | null => {
  const key = selectOnboardingProviderKey(state);
  const settings = state.agentRuntimeSettings.settings;
  return key && settings?.defaultProviderKeyId === key.id && settings.defaultChatModel
    ? key.provider
    : null;
};
