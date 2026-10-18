from collections.abc import Collection
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.types import ContentRole, ContentType, SubjectType
from uniffy.domains.permissions.access.standard import (
    StandardPolicyRow,
    resolve_direct,
    resolve_standard_rows,
)
from uniffy.domains.permissions.access.subject import AccessSubject
from uniffy.domains.permissions.access.types import (
    ResourceAccessDecision,
    ResourceKey,
    ResourceRowState,
)
from uniffy.domains.scheduling.calendar.calendars.access import (
    event_role_from_calendar,
    higher_role,
)


async def resolve_calendar_events(
    session: AsyncSession,
    subject: AccessSubject,
    content_ids: Collection[UUID],
) -> dict[ResourceKey, ResourceAccessDecision]:
    if not content_ids:
        return {}
    master = aliased(CalendarEvent)
    rows = (
        await session.execute(
            select(
                CalendarEvent.id,
                CalendarEvent.is_deleted.label("event_deleted"),
                master.id.label("master_id"),
                master.calendar_id,
                master.organizer_id,
                master.access_mode,
                master.baseline_role,
                master.is_deleted.label("master_deleted"),
            )
            .join(
                master,
                master.id == func.coalesce(CalendarEvent.recurrence_id, CalendarEvent.id),
            )
            .where(
                CalendarEvent.organization_id == subject.organization_id,
                master.organization_id == subject.organization_id,
                CalendarEvent.id.in_(content_ids),
            )
        )
    ).all()
    policy_rows = {
        StandardPolicyRow(
            key=ResourceKey(ContentType.CALENDAR_EVENT, row.master_id),
            owner_id=row.organizer_id,
            access_mode=row.access_mode,
            baseline_role=row.baseline_role,
            is_deleted=row.master_deleted,
        )
        for row in rows
    }
    master_decisions = await resolve_standard_rows(session, subject, policy_rows)
    decisions: dict[ResourceKey, ResourceAccessDecision] = {}
    for row in rows:
        key = ResourceKey(ContentType.CALENDAR_EVENT, row.id)
        parent = master_decisions[ResourceKey(ContentType.CALENDAR_EVENT, row.master_id)]
        row_state = (
            ResourceRowState.DELETED
            if row.event_deleted or parent.row_state == ResourceRowState.DELETED
            else ResourceRowState.LIVE
        )
        decisions[key] = ResourceAccessDecision(
            key=key,
            row_state=row_state,
            can_view=row_state == ResourceRowState.LIVE and parent.can_view,
            role=parent.role if row_state == ResourceRowState.LIVE else None,
            request_target=(parent.request_target if row_state == ResourceRowState.LIVE else None),
            target_policy=(parent.target_policy if row_state == ResourceRowState.LIVE else None),
        )
    if not subject.is_active_member:
        return decisions

    master_calendars = {row.master_id: row.calendar_id for row in rows}
    calendar_roles = await resolve_calendar_roles(session, subject, set(master_calendars.values()))
    denied_masters = {
        row.master_id
        for row in rows
        if decisions[ResourceKey(ContentType.CALENDAR_EVENT, row.id)].row_state
        == ResourceRowState.LIVE
        and not decisions[ResourceKey(ContentType.CALENDAR_EVENT, row.id)].can_view
    }
    attendee_ids: set[UUID] = set()
    if denied_masters:
        attendee_ids = set(
            (
                await session.execute(
                    select(EventAttendee.event_id).where(
                        EventAttendee.event_id.in_(denied_masters),
                        EventAttendee.user_id == subject.user_id,
                    )
                )
            ).scalars()
        )
    liftable = {
        master_id
        for master_id in denied_masters
        if master_id in attendee_ids or master_calendars[master_id] in calendar_roles
    }
    blocked_ids = await _blocked_event_ids(session, subject, liftable)

    for row in rows:
        key = ResourceKey(ContentType.CALENDAR_EVENT, row.id)
        decision = decisions[key]
        if decision.row_state != ResourceRowState.LIVE:
            continue
        from_calendar = calendar_roles.get(master_calendars[row.master_id])
        if decision.can_view:
            lifted = higher_role(decision.role, from_calendar)
        elif row.master_id in liftable and row.master_id not in blocked_ids:
            # Attendance is a floor and the calendar a grant; neither replaces
            # a higher role resolved for the same event.
            lifted = from_calendar or ContentRole.VIEWER
        else:
            continue
        if lifted == decision.role:
            continue
        decisions[key] = ResourceAccessDecision(
            key=key,
            row_state=decision.row_state,
            can_view=True,
            role=lifted,
            request_target=decision.request_target,
            target_policy=decision.target_policy,
        )
    return decisions


async def _blocked_event_ids(
    session: AsyncSession,
    subject: AccessSubject,
    event_ids: Collection[UUID],
) -> set[UUID]:
    if not event_ids:
        return set()
    subject_predicates = [
        and_(
            ContentMember.subject_type == SubjectType.USER,
            ContentMember.subject_id == subject.user_id,
        )
    ]
    if subject.group_ids:
        subject_predicates.append(
            and_(
                ContentMember.subject_type == SubjectType.GROUP,
                ContentMember.subject_id.in_(subject.group_ids),
            )
        )
    return set(
        (
            await session.execute(
                select(ContentMember.content_id).where(
                    ContentMember.organization_id == subject.organization_id,
                    ContentMember.content_type == ContentType.CALENDAR_EVENT,
                    ContentMember.content_id.in_(event_ids),
                    ContentMember.role == ContentRole.BLOCKED,
                    or_(*subject_predicates),
                    or_(
                        ContentMember.expires_at.is_(None),
                        ContentMember.expires_at > datetime.now(UTC),
                    ),
                )
            )
        ).scalars()
    )


async def resolve_calendar_roles(
    session: AsyncSession,
    subject: AccessSubject,
    calendar_ids: Collection[UUID],
) -> dict[UUID, ContentRole]:
    """Event role each viewable calendar confers; unviewable calendars are absent."""
    if not calendar_ids:
        return {}
    decisions = await resolve_direct(session, subject, {ContentType.CALENDAR: calendar_ids})
    roles: dict[UUID, ContentRole] = {}
    for calendar_id in calendar_ids:
        decision = decisions.get(ResourceKey(ContentType.CALENDAR, calendar_id))
        mapped = event_role_from_calendar(decision.role) if decision and decision.can_view else None
        if mapped is not None:
            roles[calendar_id] = mapped
    return roles
