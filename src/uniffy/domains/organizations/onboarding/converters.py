"""Proto mapping for the entry flow state."""

from __future__ import annotations

from uniffy_proto.organizations.v1.organizations_pb import (
    OnboardingState as OnboardingStateProto,
)
from uniffy_proto.organizations.v1.organizations_pb import (
    OnboardingStep as OnboardingStepProto,
)

from uniffy.domains.organizations.onboarding.operations import OnboardingView
from uniffy.domains.organizations.onboarding.state import OnboardingStep

STEP_TO_PROTO: dict[OnboardingStep, OnboardingStepProto] = {
    OnboardingStep.WELCOME: OnboardingStepProto.WELCOME,
    OnboardingStep.MENTIONS: OnboardingStepProto.MENTIONS,
    OnboardingStep.MENTION_DISPLAY: OnboardingStepProto.MENTION_DISPLAY,
    OnboardingStep.SHARING: OnboardingStepProto.SHARING,
    OnboardingStep.APPEARANCE: OnboardingStepProto.APPEARANCE,
    OnboardingStep.AGENTS: OnboardingStepProto.AGENTS,
    OnboardingStep.TEAM: OnboardingStepProto.TEAM,
    OnboardingStep.LAUNCH: OnboardingStepProto.LAUNCH,
}
STEP_FROM_PROTO: dict[OnboardingStepProto, OnboardingStep] = {
    proto: step for step, proto in STEP_TO_PROTO.items()
}


def onboarding_state_to_proto(view: OnboardingView) -> OnboardingStateProto:
    return OnboardingStateProto(
        pending=view.pending,
        current_step=(
            STEP_TO_PROTO[view.current_step]
            if view.current_step is not None
            else OnboardingStepProto.UNSPECIFIED
        ),
    )
