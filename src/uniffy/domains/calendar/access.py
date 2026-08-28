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
    resolve_standard_rows,
)
from uniffy.domains.permissions.access.subject import AccessSubject
from uniffy.domains.permissions.access.types import (
    ResourceAccessDecision,
    ResourceKey,
    ResourceRowState,
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

    denied_ids = {
        key.content_id
        for key, decision in decisions.items()
        if decision.row_state == ResourceRowState.LIVE and not decision.can_view
    }
    if not denied_ids:
        return decisions
    attendee_ids = set(
        (
            await session.execute(
                select(EventAttendee.event_id).where(
                    EventAttendee.event_id.in_({row.master_id for row in rows}),
                    EventAttendee.user_id == subject.user_id,
                )
            )
        ).scalars()
    )
    if not attendee_ids:
        return decisions

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
    blocked_ids = set(
        (
            await session.execute(
                select(ContentMember.content_id).where(
                    ContentMember.organization_id == subject.organization_id,
                    ContentMember.content_type == ContentType.CALENDAR_EVENT,
                    ContentMember.content_id.in_(attendee_ids),
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
    for row in rows:
        if row.master_id not in attendee_ids or row.master_id in blocked_ids:
            continue
        key = ResourceKey(ContentType.CALENDAR_EVENT, row.id)
        decision = decisions[key]
        # Attendance is a floor, not the effective role: only lift decisions the
        # standard policy denied, so an organizer or explicit EDITOR resolved in
        # the same batch as a denied event keeps their higher role.
        if decision.row_state == ResourceRowState.LIVE and not decision.can_view:
            decisions[key] = ResourceAccessDecision(
                key=key,
                row_state=decision.row_state,
                can_view=True,
                role=ContentRole.VIEWER,
                request_target=decision.request_target,
                target_policy=decision.target_policy,
            )
    return decisions
