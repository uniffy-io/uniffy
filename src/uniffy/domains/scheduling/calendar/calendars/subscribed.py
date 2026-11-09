"""The calendars an outside source fills: a feed subscription or a connected provider calendar."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.types import AccessMode, CalendarType
from uniffy.domains.scheduling.calendar.calendars.fields import validated_color, validated_name
from uniffy.domains.scheduling.calendar.calendars.search import record_calendar_search_acl_refresh


async def stage_subscribed_calendar(
    session: AsyncSession, user_id: UUID, organization_id: UUID, name: str, color: str
) -> Calendar:
    """The read-only calendar a new feed subscription fills; the caller commits."""
    return await _stage(session, user_id, organization_id, name, color, CalendarType.SUBSCRIBED)


async def stage_connected_calendar(
    session: AsyncSession, user_id: UUID, organization_id: UUID, name: str, color: str
) -> Calendar:
    """The calendar a provider calendar syncs into; the caller commits."""
    return await _stage(session, user_id, organization_id, name, color, CalendarType.CONNECTED)


async def _stage(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    name: str,
    color: str,
    calendar_type: CalendarType,
) -> Calendar:
    calendar = Calendar(
        organization_id=organization_id,
        owner_id=user_id,
        name=validated_name(name),
        color=validated_color(color),
        calendar_type=calendar_type,
        is_default=False,
        # Explicit, so an organization default of OPEN_TO_ORG never reaches a mirror.
        access_mode=AccessMode.OWNER_ONLY,
        baseline_role=None,
    )
    session.add(calendar)
    await session.flush()
    await write_audit_event(
        session,
        organization_id=organization_id,
        actor_user_id=user_id,
        action=Action.CALENDAR_CREATED,
        resource_type=AuditResourceType.CALENDAR,
        resource_id=calendar.id,
        details={"name": calendar.name, "calendar_type": calendar_type.value},
    )
    await record_calendar_search_acl_refresh(session, organization_id, calendar.id)
    return calendar
