"""Entry flow state for a new organization, one JSON blob in its ``org_settings``."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.config.settings.organization import OrgSettingsOperations
from uniffy.core.models.settings.org_setting import OrgSetting

ONBOARDING_NAMESPACE = "onboarding"
ENTRY_KEY = "entry"


class OnboardingStatus(StrEnum):
    PENDING = "pending"
    COMPLETED = "completed"
    DISMISSED = "dismissed"


class OnboardingStep(StrEnum):
    WELCOME = "welcome"
    MENTIONS = "mentions"
    MENTION_DISPLAY = "mention_display"
    SHARING = "sharing"
    APPEARANCE = "appearance"
    AGENTS = "agents"
    TEAM = "team"
    LAUNCH = "launch"


@dataclass(frozen=True, slots=True)
class OnboardingEntry:
    """The flow belongs to the user who created the organization, not to whoever owns it later."""

    user_id: UUID
    status: OnboardingStatus = OnboardingStatus.PENDING
    current_step: OnboardingStep = OnboardingStep.WELCOME
    finished_at: datetime | None = None

    def to_blob(self) -> dict[str, str | None]:
        return {
            "user_id": str(self.user_id),
            "status": self.status.value,
            "current_step": self.current_step.value,
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
        }


def entry_from_blob(blob: object) -> OnboardingEntry | None:
    """A malformed blob reads as no flow at all, so it can never trap an owner inside it."""
    if not isinstance(blob, dict):
        return None
    try:
        finished_at = blob.get("finished_at")
        return OnboardingEntry(
            user_id=UUID(str(blob["user_id"])),
            status=OnboardingStatus(blob["status"]),
            current_step=OnboardingStep(blob.get("current_step", OnboardingStep.WELCOME)),
            finished_at=datetime.fromisoformat(finished_at) if finished_at else None,
        )
    except KeyError, TypeError, ValueError:
        return None


async def load_onboarding(
    session: AsyncSession,
    organization_id: UUID,
    *,
    for_update: bool = False,
) -> OnboardingEntry | None:
    """``for_update`` holds the row so a double submit of the last step finishes the flow once."""
    statement = select(OrgSetting).where(
        OrgSetting.organization_id == organization_id,
        OrgSetting.namespace == ONBOARDING_NAMESPACE,
        OrgSetting.key == ENTRY_KEY,
    )
    if for_update:
        statement = statement.with_for_update()
    row = (await session.execute(statement)).scalar_one_or_none()
    if row is None or row.is_secret:
        return None
    return entry_from_blob(row.value)


async def save_onboarding(
    session: AsyncSession,
    *,
    organization_id: UUID,
    entry: OnboardingEntry,
    updated_by_user_id: UUID,
) -> None:
    await OrgSettingsOperations(session).set(
        organization_id=organization_id,
        namespace=ONBOARDING_NAMESPACE,
        key=ENTRY_KEY,
        value=entry.to_blob(),
        updated_by_user_id=updated_by_user_id,
    )


async def stage_onboarding(
    session: AsyncSession,
    *,
    organization_id: UUID,
    user_id: UUID,
) -> None:
    """Joins the creating transaction, so an organization never exists without its pending flow."""
    await save_onboarding(
        session,
        organization_id=organization_id,
        entry=OnboardingEntry(user_id=user_id),
        updated_by_user_id=user_id,
    )
