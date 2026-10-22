"""Who still has the entry flow ahead of them, and moving it forward."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.domains.organizations.onboarding.state import (
    OnboardingEntry,
    OnboardingStatus,
    OnboardingStep,
    load_onboarding,
    save_onboarding,
)
from uniffy.domains.organizations.operations import OrganizationOperations

logger = logger.bind(component="organizations.onboarding.operations")


@dataclass(frozen=True, slots=True)
class OnboardingView:
    pending: bool
    current_step: OnboardingStep | None


def _view(
    entry: OnboardingEntry | None,
    user_id: UUID,
    membership: OrganizationMember,
) -> OnboardingView:
    if entry is None or entry.user_id != user_id:
        return OnboardingView(pending=False, current_step=None)
    # An ownership transfer ends the flow for its creator; the new owner never inherits it.
    pending = entry.status is OnboardingStatus.PENDING and membership.role == OrganizationRole.OWNER
    return OnboardingView(pending=pending, current_step=entry.current_step)


class OnboardingOperations:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._organizations = OrganizationOperations(session)

    async def get_state(self, user_id: UUID, organization_id: UUID) -> OnboardingView:
        membership = await self._organizations.require_org_member(user_id, organization_id)
        entry = await load_onboarding(self._session, organization_id)
        return _view(entry, user_id, membership)

    async def record_step(
        self,
        user_id: UUID,
        organization_id: UUID,
        step: OnboardingStep,
    ) -> OnboardingView:
        view, _ = await self._advance(
            user_id,
            organization_id,
            lambda entry: replace(entry, current_step=step),
        )
        return view

    async def finish(
        self,
        user_id: UUID,
        organization_id: UUID,
        *,
        dismissed: bool,
    ) -> OnboardingView:
        status = OnboardingStatus.DISMISSED if dismissed else OnboardingStatus.COMPLETED
        view, changed = await self._advance(
            user_id,
            organization_id,
            lambda entry: replace(entry, status=status, finished_at=datetime.now(UTC)),
        )
        if changed:
            logger.info(
                "Organization entry flow finished",
                organization_id=str(organization_id),
                user_id=str(user_id),
                status=status.value,
            )
        return view

    async def _advance(
        self,
        user_id: UUID,
        organization_id: UUID,
        change: Callable[[OnboardingEntry], OnboardingEntry],
    ) -> tuple[OnboardingView, bool]:
        """Once the flow is over for the caller, every call answers with the state it left."""
        membership = await self._organizations.require_org_owner(user_id, organization_id)
        try:
            entry = await load_onboarding(self._session, organization_id, for_update=True)
            if entry is None or not _view(entry, user_id, membership).pending:
                await self._session.rollback()
                return _view(entry, user_id, membership), False
            updated = change(entry)
            await save_onboarding(
                self._session,
                organization_id=organization_id,
                entry=updated,
                updated_by_user_id=user_id,
            )
            await self._session.commit()
        except Exception:
            await self._session.rollback()
            raise
        return _view(updated, user_id, membership), True
