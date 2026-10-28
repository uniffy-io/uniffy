"""Entry flow RPCs; domain errors reach the client through the transport's typed mapping."""

from __future__ import annotations

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from uniffy_proto.organizations.v1.organizations_pb import (
    FinishOnboardingRequest,
    FinishOnboardingResponse,
    GetOnboardingRequest,
    GetOnboardingResponse,
    RecordOnboardingStepRequest,
    RecordOnboardingStepResponse,
)

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.domains.organizations.onboarding.converters import (
    STEP_FROM_PROTO,
    onboarding_state_to_proto,
)
from uniffy.domains.organizations.onboarding.operations import OnboardingOperations
from uniffy.infrastructure.database import open_session


class OrganizationOnboardingHandlers:
    async def get_onboarding(
        self,
        request: GetOnboardingRequest,
        ctx: RequestContext,
    ) -> GetOnboardingResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        async with open_session() as session:
            view = await OnboardingOperations(session).get_state(user_id, organization_id)
        return GetOnboardingResponse(state=onboarding_state_to_proto(view))

    async def record_onboarding_step(
        self,
        request: RecordOnboardingStepRequest,
        ctx: RequestContext,
    ) -> RecordOnboardingStepResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        step = STEP_FROM_PROTO.get(request.step)
        if step is None:
            raise ConnectError(Code.INVALID_ARGUMENT, "step is required")
        async with open_session() as session:
            view = await OnboardingOperations(session).record_step(user_id, organization_id, step)
        return RecordOnboardingStepResponse(state=onboarding_state_to_proto(view))

    async def finish_onboarding(
        self,
        request: FinishOnboardingRequest,
        ctx: RequestContext,
    ) -> FinishOnboardingResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        async with open_session() as session:
            view = await OnboardingOperations(session).finish(
                user_id,
                organization_id,
                dismissed=request.dismissed,
            )
        return FinishOnboardingResponse(state=onboarding_state_to_proto(view))
