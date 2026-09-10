"""Calendar point paths resolve membership and grants the way the list paths do.

`remove_member` leaves attendee rows behind, and a template's access mode used
to be enforced only by the list filter. Both gates are proven here against
real rows: what a deactivated member, a member of another org, a granted
member, and a blocked member can actually do.
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import select

from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.template import EventTemplate
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.types import (
    AccessMode,
    AttendeeStatus,
    ContentRole,
    ContentType,
    SubjectType,
    generate_id,
)
from uniffy.domains.scheduling.calendar.operations import (
    CalendarEventOperations,
    EventTemplateOperations,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")

NOTIFY = "uniffy.domains.scheduling.calendar.events.attendees.emit_notification"


async def _deactivate(session, access, user_id) -> None:
    membership = (
        await session.execute(
            select(OrganizationMember).where(
                OrganizationMember.organization_id == access.org_id,
                OrganizationMember.user_id == user_id,
            )
        )
    ).scalar_one()
    membership.is_active = False
    await session.commit()


async def _event_with_attendee(session, access, attendee_id) -> CalendarEvent:
    """An OWNER_ONLY event the attendee reaches only through the invitation floor."""
    now = datetime.now(UTC)
    calendar = Calendar(
        organization_id=access.org_id,
        owner_id=access.member_id,
        name=f"cal-{generate_id().hex[:8]}",
    )
    session.add(calendar)
    await session.flush()

    event = CalendarEvent(
        organization_id=access.org_id,
        organizer_id=access.member_id,
        calendar_id=calendar.id,
        title="1:1 Sync",
        start_time=now,
        end_time=now,
        access_mode=AccessMode.OWNER_ONLY,
    )
    session.add(event)
    await session.flush()

    session.add(EventAttendee(event_id=event.id, user_id=attendee_id))
    await session.commit()
    return event


async def _attendee_status(session, event_id, user_id) -> AttendeeStatus:
    row = (
        await session.execute(
            select(EventAttendee).where(
                EventAttendee.event_id == event_id,
                EventAttendee.user_id == user_id,
            )
        )
    ).scalar_one()
    await session.refresh(row)
    return row.status


async def _respond(session, access, user_id, event_id) -> bool:
    return await CalendarEventOperations(
        session, search_indexer=MagicMock()
    ).update_attendee_status(user_id, access.org_id, event_id, AttendeeStatus.ACCEPTED)


class TestRsvpMembershipGate:
    async def test_an_active_attendee_responds(self, session, access, monkeypatch) -> None:
        monkeypatch.setattr(NOTIFY, AsyncMock())
        event = await _event_with_attendee(session, access, access.peer_id)

        assert await _respond(session, access, access.peer_id, event.id) is True

        assert await _attendee_status(session, event.id, access.peer_id) is AttendeeStatus.ACCEPTED

    async def test_a_deactivated_attendee_cannot_respond(self, session, access) -> None:
        event = await _event_with_attendee(session, access, access.peer_id)
        await _deactivate(session, access, access.peer_id)

        with pytest.raises(PermissionDeniedError):
            await _respond(session, access, access.peer_id, event.id)

        assert await _attendee_status(session, event.id, access.peer_id) is AttendeeStatus.PENDING

    async def test_an_attendee_row_from_another_org_confers_nothing(
        self, session, access
    ) -> None:
        event = await _event_with_attendee(session, access, access.outsider_id)

        with pytest.raises(PermissionDeniedError):
            await _respond(session, access, access.outsider_id, event.id)

        assert (
            await _attendee_status(session, event.id, access.outsider_id) is AttendeeStatus.PENDING
        )


async def _template(session, access, *, access_mode, baseline_role=None) -> EventTemplate:
    template = EventTemplate(
        organization_id=access.org_id,
        title=f"tpl-{generate_id().hex[:8]}",
        created_by=access.member_id,
        access_mode=access_mode,
        baseline_role=baseline_role,
    )
    session.add(template)
    await session.commit()
    return template


async def _grant(session, access, template, user_id, role) -> None:
    session.add(
        ContentMember(
            organization_id=access.org_id,
            content_type=ContentType.CALENDAR_EVENT,
            content_id=template.id,
            subject_type=SubjectType.USER,
            subject_id=user_id,
            role=role,
            added_by_user_id=access.member_id,
        )
    )
    await session.commit()


async def _read(session, access, user_id, template_id) -> EventTemplate:
    return await EventTemplateOperations(session).get_by_id(template_id, access.org_id, user_id)


async def _listed_ids(session, access, user_id) -> set:
    templates = await EventTemplateOperations(session).list(access.org_id, user_id)
    return {template.id for template in templates}


class TestTemplateDirectRead:
    async def test_the_creator_reads_their_own(self, session, access) -> None:
        template = await _template(session, access, access_mode=AccessMode.OWNER_ONLY)

        fetched = await _read(session, access, access.member_id, template.id)

        assert fetched.id == template.id

    async def test_a_member_without_a_grant_is_denied(self, session, access) -> None:
        template = await _template(session, access, access_mode=AccessMode.EXPLICIT_MEMBERS)

        with pytest.raises(PermissionDeniedError):
            await _read(session, access, access.peer_id, template.id)

    async def test_a_granted_member_reads_it(self, session, access) -> None:
        template = await _template(session, access, access_mode=AccessMode.EXPLICIT_MEMBERS)
        await _grant(session, access, template, access.peer_id, ContentRole.VIEWER)

        fetched = await _read(session, access, access.peer_id, template.id)

        assert fetched.id == template.id

    async def test_a_blocked_member_is_denied_on_an_org_wide_template(
        self, session, access
    ) -> None:
        template = await _template(
            session,
            access,
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.VIEWER,
        )
        await _grant(session, access, template, access.peer_id, ContentRole.BLOCKED)

        with pytest.raises(PermissionDeniedError):
            await _read(session, access, access.peer_id, template.id)
        assert (await _read(session, access, access.admin_id, template.id)).id == template.id

    async def test_a_deactivated_member_is_denied(self, session, access) -> None:
        template = await _template(
            session,
            access,
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.VIEWER,
        )

        with pytest.raises(PermissionDeniedError):
            await _read(session, access, access.ghost_id, template.id)

    async def test_the_direct_read_agrees_with_the_list(self, session, access) -> None:
        """The audit finding: hidden from the list yet readable by id."""
        template = await _template(session, access, access_mode=AccessMode.EXPLICIT_MEMBERS)

        assert template.id not in await _listed_ids(session, access, access.peer_id)
        with pytest.raises(PermissionDeniedError):
            await _read(session, access, access.peer_id, template.id)

        await _grant(session, access, template, access.peer_id, ContentRole.VIEWER)

        assert template.id in await _listed_ids(session, access, access.peer_id)
        assert (await _read(session, access, access.peer_id, template.id)).id == template.id
