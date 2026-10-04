from collections.abc import Collection
from dataclasses import replace
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from uniffy.core.auth.permissions.roles import role_can_edit
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.delegation import CalendarDelegationLevel
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.types import ContentRole, ContentType, EventVisibility, SubjectType
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
from uniffy.domains.scheduling.calendar.delegation.access import (
    delegated_event_role,
    delegation_levels,
    invited_grantors,
    private_detail_stand_ins,
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
                CalendarEvent.visibility.label("event_visibility"),
                master.id.label("master_id"),
                master.calendar_id,
                master.organizer_id,
                master.arranged_by_id,
                master.visibility.label("master_visibility"),
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
        return await _mark_hidden_details(session, subject, rows, decisions)

    master_calendars = {row.master_id: row.calendar_id for row in rows}
    calendar_roles = await resolve_calendar_roles(session, subject, set(master_calendars.values()))
    levels = await delegation_levels(
        session, subject.user_id, subject.organization_id, set(master_calendars.values())
    )
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
    # The private cap needs to know whether a delegate was invited to a private event.
    capped_candidates = {
        row.master_id
        for row in rows
        if master_calendars[row.master_id] in levels
        and _is_private(row)
        and subject.user_id not in (row.organizer_id, row.arranged_by_id)
    } - denied_masters
    if capped_candidates:
        attendee_ids |= set(
            (
                await session.execute(
                    select(EventAttendee.event_id).where(
                        EventAttendee.event_id.in_(capped_candidates),
                        EventAttendee.user_id == subject.user_id,
                    )
                )
            ).scalars()
        )
    unexplained = {
        master_id
        for master_id in denied_masters
        if master_id not in attendee_ids
        and master_calendars[master_id] not in calendar_roles
        and master_calendars[master_id] not in levels
    }
    # What a grantor is invited to, their delegate may see and answer for.
    grantor_invited = await invited_grantors(
        session, subject.user_id, subject.organization_id, unexplained
    )
    liftable = {
        master_id
        for master_id in denied_masters
        if master_id in attendee_ids
        or master_id in grantor_invited
        or master_calendars[master_id] in calendar_roles
        or master_calendars[master_id] in levels
    }
    blocked_ids = await _blocked_event_ids(session, subject, liftable)

    for row in rows:
        key = ResourceKey(ContentType.CALENDAR_EVENT, row.id)
        decision = decisions[key]
        if decision.row_state != ResourceRowState.LIVE:
            continue
        from_calendar = higher_role(
            calendar_roles.get(master_calendars[row.master_id]),
            _delegated_role(levels, master_calendars[row.master_id], row, subject, attendee_ids),
        )
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
    return await _mark_hidden_details(session, subject, rows, decisions)


async def _mark_hidden_details(
    session: AsyncSession,
    subject: AccessSubject,
    rows,
    decisions: dict[ResourceKey, ResourceAccessDecision],
) -> dict[ResourceKey, ResourceAccessDecision]:
    """Flag private events the viewer sees only as busy, by the rule of ``event_details_hidden``."""
    candidates: dict[ResourceKey, UUID] = {}
    for row in rows:
        key = ResourceKey(ContentType.CALENDAR_EVENT, row.id)
        decision = decisions[key]
        if (
            decision.can_view
            and _is_private(row)
            and not role_can_edit(decision.role)
            and subject.user_id not in (row.organizer_id, row.arranged_by_id)
        ):
            candidates[key] = row.master_id
    if not candidates:
        return decisions
    stand_ins = await private_detail_stand_ins(session, subject.user_id, subject.organization_id)
    attending = set(
        (
            await session.execute(
                select(EventAttendee.event_id).where(
                    EventAttendee.event_id.in_(set(candidates.values())),
                    EventAttendee.user_id.in_(stand_ins),
                )
            )
        ).scalars()
    )
    for key, master_id in candidates.items():
        if master_id not in attending:
            decisions[key] = replace(decisions[key], details_hidden=True)
    return decisions


def _is_private(row) -> bool:
    return EventVisibility.PRIVATE in (row.event_visibility, row.master_visibility)


def _delegated_role(
    levels: dict[UUID, CalendarDelegationLevel],
    calendar_id: UUID,
    row,
    subject: AccessSubject,
    attendee_ids: set[UUID],
) -> ContentRole | None:
    level = levels.get(calendar_id)
    if level is None:
        return None
    return delegated_event_role(
        level,
        row.organizer_id,
        subject.user_id,
        private=_is_private(row),
        is_attendee=row.master_id in attendee_ids,
        arranged_by_id=row.arranged_by_id,
    )


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
