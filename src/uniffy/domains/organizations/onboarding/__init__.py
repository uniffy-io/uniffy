"""First-run entry flow for the user who created an organization."""

# OnboardingOperations is imported from its module: it reuses the OrganizationOperations gates,
# and organizations.operations imports this package to stage the flow on creation.
from uniffy.domains.organizations.onboarding.state import (
    OnboardingEntry,
    OnboardingStatus,
    OnboardingStep,
    load_onboarding,
    stage_onboarding,
)

__all__ = [
    "OnboardingEntry",
    "OnboardingStatus",
    "OnboardingStep",
    "load_onboarding",
    "stage_onboarding",
]
