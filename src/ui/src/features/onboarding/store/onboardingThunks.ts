import { createAsyncThunk } from "@reduxjs/toolkit";
import type { OnboardingState as OnboardingStateProto } from "@uniffy/proto/organizations/v1/organizations_pb";
import type { AppDispatch, RootState } from "@/app/store";
import { onboardingApi } from "@/features/onboarding/api/onboardingApi";
import type { OrganizationOnboarding } from "@/features/onboarding/store/onboardingSlice";
import {
  FIRST_STEP,
  stepFromProto,
  stepToProto,
  type OnboardingStepId,
} from "@/features/onboarding/steps";

const thunk = createAsyncThunk.withTypes<{
  state: RootState;
  dispatch: AppDispatch;
  rejectValue: string;
}>();

function toOnboarding(state: OnboardingStateProto | undefined): OrganizationOnboarding {
  if (!state) return { pending: false, currentStep: FIRST_STEP };
  return { pending: state.pending, currentStep: stepFromProto(state.currentStep) };
}

const failure = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

/** Read once per organization per tab; a failed read stays settled so the app is never held. */
export const fetchOnboarding = thunk<OrganizationOnboarding, string>(
  "onboarding/fetch",
  async (organizationId, { rejectWithValue }) => {
    try {
      return toOnboarding((await onboardingApi.get(organizationId)).state);
    } catch (error) {
      return rejectWithValue(failure(error, "Failed to load onboarding"));
    }
  },
  {
    condition: (organizationId, { getState }) => {
      const { onboarding } = getState();
      return !onboarding.byOrganization[organizationId] && !onboarding.settled[organizationId];
    },
  },
);

export const recordOnboardingStep = thunk<
  OrganizationOnboarding,
  { organizationId: string; step: OnboardingStepId }
>("onboarding/recordStep", async ({ organizationId, step }, { rejectWithValue }) => {
  try {
    return toOnboarding((await onboardingApi.recordStep(organizationId, stepToProto(step))).state);
  } catch (error) {
    return rejectWithValue(failure(error, "Failed to save your progress"));
  }
});

export const finishOnboarding = thunk<
  OrganizationOnboarding,
  { organizationId: string; dismissed: boolean }
>("onboarding/finish", async ({ organizationId, dismissed }, { rejectWithValue }) => {
  try {
    return toOnboarding((await onboardingApi.finish(organizationId, dismissed)).state);
  } catch (error) {
    return rejectWithValue(failure(error, "Failed to finish setup"));
  }
});
