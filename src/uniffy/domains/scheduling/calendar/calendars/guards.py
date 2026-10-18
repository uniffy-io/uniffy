"""Organization policy applied to calendar sharing changes made through the members service."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.defaults import (
    resolve_content_defaults,
    resolve_effective_policy,
)
from uniffy.core.errors import ValidationError
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.types import AccessMode, ContentRole, ContentType
from uniffy.domains.scheduling.calendar.policy import require_can_open_calendar_to_org


async def guard_calendar_access_mode(
    session: AsyncSession,
    actor_user_id: UUID,
    organization_id: UUID,
    content: object,
    new_access_mode: AccessMode | None,
    new_baseline_role: ContentRole | None,
) -> None:
    # Clearing the mode inherits the org default live, so it may open the calendar
    # now or whenever an admin later opens that default; both count as opening it.
    if new_access_mode is None:
        await require_can_open_calendar_to_org(session, actor_user_id, organization_id)
        return
    default_mode, default_baseline = await resolve_content_defaults(
        session, organization_id, ContentType.CALENDAR
    )
    mode, _baseline = resolve_effective_policy(
        new_access_mode, new_baseline_role, default_mode, default_baseline
    )
    if mode == AccessMode.OPEN_TO_ORG:
        await require_can_open_calendar_to_org(session, actor_user_id, organization_id)


async def guard_calendar_transfer(
    session: AsyncSession,
    organization_id: UUID,
    content: object,
    new_owner_user_id: UUID,
) -> None:
    # Everyone keeps exactly one default calendar, so it never changes hands.
    if isinstance(content, Calendar) and content.is_default:
        raise ValidationError(
            "content_id", "A default calendar cannot be transferred to someone else."
        )


async def guard_event_access_mode(
    session: AsyncSession,
    actor_user_id: UUID,
    organization_id: UUID,
    content: object,
    new_access_mode: AccessMode | None,
    new_baseline_role: ContentRole | None,
) -> None:
    if new_access_mode == AccessMode.OPEN_TO_ORG:
        raise ValidationError(
            "access_mode",
            "Calendar events are invite-only and cannot be opened to the organization.",
        )
