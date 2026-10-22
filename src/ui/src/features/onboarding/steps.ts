import { OnboardingStep } from "@uniffy/proto/organizations/v1/organizations_pb";

export const ONBOARDING_STEPS = [
  { id: "welcome", proto: OnboardingStep.WELCOME, label: "Welcome" },
  { id: "mentions", proto: OnboardingStep.MENTIONS, label: "Connect" },
  { id: "mentionDisplay", proto: OnboardingStep.MENTION_DISPLAY, label: "Mentions" },
  { id: "sharing", proto: OnboardingStep.SHARING, label: "Sharing" },
  { id: "appearance", proto: OnboardingStep.APPEARANCE, label: "Look" },
  { id: "agents", proto: OnboardingStep.AGENTS, label: "Agents" },
  { id: "team", proto: OnboardingStep.TEAM, label: "Team" },
  { id: "launch", proto: OnboardingStep.LAUNCH, label: "Launch" },
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]["id"];

export const FIRST_STEP: OnboardingStepId = "welcome";

export function stepIndex(id: OnboardingStepId): number {
  return ONBOARDING_STEPS.findIndex((step) => step.id === id);
}

export function stepFromProto(step: OnboardingStep): OnboardingStepId {
  return ONBOARDING_STEPS.find((entry) => entry.proto === step)?.id ?? FIRST_STEP;
}

export function stepToProto(id: OnboardingStepId): OnboardingStep {
  return ONBOARDING_STEPS[stepIndex(id)].proto;
}
