"""Moving part of a series tells the people on it, against real rows."""

from datetime import UTC, date, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from icalendar import Calendar as IcalCalendar
from sqlalchemy import delete, select, update

from uniffy.core.mail import MailResult, render_template
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.models.notifications.email_delivery import (
    EmailComposer,
    NotificationEmailDelivery,
    NotificationEmailStatus,
)
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.rooms.booking import RoomBooking
from uniffy.core.models.rooms.room import Room
from uniffy.core.models.tags.tag import Tag, TagAssignment
from uniffy.core.search import SearchIndexer
from uniffy.core.types import (
    BookingStatus,
    ContentRole,
    ContentType,
    EventStatus,
    RecurrenceEditScope,
    RecurrencePattern,
    RoomType,
    SubjectType,
    generate_id,
)
from uniffy.domains.chat.lifecycle import ChannelCallLifecycle
from uniffy.domains.scheduling.calendar.events.registration import register_calendar_content
from uniffy.domains.scheduling.calendar.jobs.event_mail import send_calendar_event_mail
from uniffy.domains.scheduling.calendar.mail.compose import build_message_document, load_bundle
from uniffy.domains.scheduling.calendar.mail.outbox import CalendarMailKind, read_event_mail
from uniffy.domains.scheduling.calendar.mail.withdrawal import withdrawal_document
from uniffy.domains.scheduling.calendar.operations import CalendarEventOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")

SERIES_START = datetime(2026, 3, 18, 9, tzinfo=UTC)
OCCURRENCE = date(2026, 3, 25)


async def _series(session, env) -> tuple[Calendar, CalendarEvent]:
    register_calendar_content()
    calendar = Calendar(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        name=f"scoped-{generate_id().hex[:8]}",
    )
    session.add(calendar)
    await session.commit()

    event = await CalendarEventOperations(session, MagicMock(spec=SearchIndexer)).create(
        user_id=env.admin_id,
        organization_id=env.org_id,
        title="Standup",
        start_time=SERIES_START,
        end_time=SERIES_START + timedelta(minutes=30),
        calendar_id=calendar.id,
        recurrence_pattern=RecurrencePattern.WEEKLY,
        recurrence_config={"interval": 1},
        attendee_ids=[env.member_id],
    )
    return calendar, event


async def _invitation_already_sent(session, env) -> None:
    """The scoped edit is what this asserts, so the invitation the creation
    staged is settled first rather than absorbing it."""
    await session.execute(
        update(NotificationEmailDelivery)
        .where(NotificationEmailDelivery.organization_id == env.org_id)
        .values(status=NotificationEmailStatus.SENT)
    )
    await session.commit()


async def _staged(session, env) -> list:
    rows = (
        (
            await session.execute(
                select(NotificationEmailDelivery).where(
                    NotificationEmailDelivery.composer == EmailComposer.CALENDAR.value,
                    NotificationEmailDelivery.user_id == env.member_id,
                    NotificationEmailDelivery.status == NotificationEmailStatus.PENDING,
                )
            )
        )
        .scalars()
        .all()
    )
    return [read_event_mail(row) for row in rows]


async def _clear(session, env, calendar_id) -> None:
    await session.rollback()
    await session.execute(delete(Tag).where(Tag.organization_id == env.org_id))
    await session.execute(
        delete(NotificationEmailDelivery).where(
            NotificationEmailDelivery.organization_id == env.org_id
        )
    )
    await session.execute(delete(CalendarEvent).where(CalendarEvent.calendar_id == calendar_id))
    await session.execute(delete(Calendar).where(Calendar.id == calendar_id))
    await session.commit()


async def test_moving_one_occurrence_tells_the_room(session, env) -> None:
    """A scoped edit used to settle silently: the occurrence moved and nobody
    on the meeting heard about it."""
    calendar, event = await _series(session, env)
    calendar_id, event_id = calendar.id, event.id
    ops = CalendarEventOperations(session, MagicMock(spec=SearchIndexer))
    before = event.ical_sequence
    await _invitation_already_sent(session, env)

    try:
        await ops.edit_single_occurrence(
            env.admin_id,
            env.org_id,
            event_id,
            OCCURRENCE,
            start_time=datetime(2026, 3, 25, 14, tzinfo=UTC),
            end_time=datetime(2026, 3, 25, 14, 30, tzinfo=UTC),
        )

        staged = await _staged(session, env)
        assert [request.kind for request in staged] == [CalendarMailKind.CHANGE]
        assert "schedule_changed" in staged[0].changes
        assert (await session.get(CalendarEvent, event_id)).ical_sequence == before + 1
        bundle = await load_bundle(session, event_id)
        document = IcalCalendar.from_ical(build_message_document(bundle, staged[0]))
        components = document.walk("VEVENT")
        assert len(components) == 2
        assert {int(component["SEQUENCE"]) for component in components} == {before + 1}
        await ops.update(
            env.admin_id,
            env.org_id,
            event_id,
            location="Second room",
            call_lifecycle=AsyncMock(spec=ChannelCallLifecycle),
        )
        bundle = await load_bundle(session, event_id)
        document = IcalCalendar.from_ical(
            build_message_document(bundle, (await _staged(session, env))[0])
        )
        assert {int(component["SEQUENCE"]) for component in document.walk("VEVENT")} == {before + 2}
    finally:
        await _clear(session, env, calendar_id)


async def test_splitting_a_series_tells_the_room_about_both_halves(session, env) -> None:
    """The series everybody holds now stops earlier, and the one taking over
    is a meeting they have never been sent."""
    calendar, event = await _series(session, env)
    calendar_id, event_id = calendar.id, event.id
    ops = CalendarEventOperations(session, MagicMock(spec=SearchIndexer))
    await _invitation_already_sent(session, env)

    try:
        await ops.edit_this_and_following(
            env.admin_id,
            env.org_id,
            event_id,
            OCCURRENCE,
            start_time=datetime(2026, 3, 25, 14, tzinfo=UTC),
            end_time=datetime(2026, 3, 25, 14, 30, tzinfo=UTC),
        )

        kinds = {request.kind for request in await _staged(session, env)}
        assert kinds == {CalendarMailKind.CHANGE, CalendarMailKind.INVITATION}
    finally:
        await _clear(session, env, calendar_id)


@pytest.mark.parametrize("occurrence", [SERIES_START.date(), OCCURRENCE])
async def test_cancel_following_withdraws_original_series_identity(session, env, occurrence) -> None:
    calendar, event = await _series(session, env)
    calendar_id, event_id = calendar.id, event.id
    ops = CalendarEventOperations(session, MagicMock(spec=SearchIndexer))
    before = event.ical_sequence
    await _invitation_already_sent(session, env)
    try:
        await ops.edit_this_and_following(
            env.admin_id, env.org_id, event_id, occurrence, status=EventStatus.CANCELLED
        )
        requests = await _staged(session, env)
        assert len(requests) == 1
        request = requests[0]
        assert request.event_id == event_id
        assert request.withdrawal.sequence == before + 1
        document = IcalCalendar.from_ical(
            withdrawal_document(request.withdrawal, "member@test.local")
        )
        cancelled = document.walk("VEVENT")[0]
        assert str(cancelled["UID"]) == f"{event_id}@uniffy"
        assert cancelled["RECURRENCE-ID"].dt == datetime.combine(occurrence, SERIES_START.timetz())
        assert cancelled["RECURRENCE-ID"].params["RANGE"] == "THISANDFUTURE"
        assert "SUMMARY" not in cancelled
    finally:
        await _clear(session, env, calendar_id)


@pytest.mark.parametrize("permanent", [False, True])
async def test_deleted_series_delivers_minimal_cancellation(session, env, permanent) -> None:
    calendar, event = await _series(session, env)
    calendar_id, event_id = calendar.id, event.id
    ops = CalendarEventOperations(session, MagicMock(spec=SearchIndexer))
    try:
        event.ical_uid = "imported-meeting@example.test"
        event.description = "Private agenda"
        await session.execute(
            update(User).where(User.id == env.member_id).values(email_verified=True)
        )
        await session.commit()
        await ops.edit_single_occurrence(
            env.admin_id,
            env.org_id,
            event_id,
            OCCURRENCE,
            start_time=datetime(2026, 3, 25, 14, tzinfo=UTC),
            end_time=datetime(2026, 3, 25, 14, 30, tzinfo=UTC),
        )
        await ops.delete(env.admin_id, env.org_id, event_id, permanent=permanent)
        request = next(request for request in await _staged(session, env) if request.withdrawal)
        assert request.withdrawal.uid == "imported-meeting@example.test"
        assert request.withdrawal.sequence == 2
        rows = list(
            (
                await session.scalars(
                    select(CalendarEvent).where(
                        CalendarEvent.calendar_id == calendar_id,
                    )
                )
            ).all()
        )
        assert rows == [] if permanent else all(row.is_deleted for row in rows)
        await session.execute(
            update(NotificationEmailDelivery)
            .where(
                NotificationEmailDelivery.id == request.delivery_id,
            )
            .values(scheduled_for=datetime.now(UTC) - timedelta(seconds=1))
        )
        await session.commit()
        sender = AsyncMock()
        sender.send.return_value = MailResult(success=True, provider_message_id="withdrawal-1")
        with (
            patch(
                "uniffy.domains.scheduling.calendar.jobs.event_mail._get_sender", return_value=sender
            ),
            patch(
                "uniffy.domains.scheduling.calendar.jobs.event_mail.load_bundle",
                side_effect=AssertionError("Deleted content read"),
            ),
        ):
            result = await send_calendar_event_mail({}, str(request.delivery_id))
        assert result["status"] == NotificationEmailStatus.SENT
        sent = sender.send.await_args.kwargs
        assert sent["template_name"] == "calendar/withdrawal"
        rendered = await render_template(sent["template_name"], sent["context"])
        assert rendered.subject == "Meeting cancelled"
        assert "Private agenda" not in rendered.text
        document = sent["calendar_part"].document
        assert b"Standup" not in document
        assert b"Private agenda" not in document
        cancelled = IcalCalendar.from_ical(document).walk("VEVENT")[0]
        assert str(cancelled["UID"]) == "imported-meeting@example.test"
        assert str(cancelled["STATUS"]) == "CANCELLED"
        assert "RECURRENCE-ID" not in cancelled
    finally:
        await _clear(session, env, calendar_id)


@pytest.mark.parametrize("revoke", ["membership", "blocked"])
async def test_deleted_event_withdrawal_rechecks_recipient(session, env, revoke) -> None:
    calendar, event = await _series(session, env)
    calendar_id, event_id = calendar.id, event.id
    ops = CalendarEventOperations(session, MagicMock(spec=SearchIndexer))
    try:
        await session.execute(
            update(User).where(User.id == env.member_id).values(email_verified=True)
        )
        await session.commit()
        await ops.delete(env.admin_id, env.org_id, event_id, permanent=True)
        request = (await _staged(session, env))[0]
        if revoke == "membership":
            await session.execute(
                update(OrganizationMember)
                .where(
                    OrganizationMember.organization_id == env.org_id,
                    OrganizationMember.user_id == env.member_id,
                )
                .values(is_active=False)
            )
        else:
            session.add(
                ContentMember(
                    organization_id=env.org_id,
                    content_type=ContentType.CALENDAR_EVENT,
                    content_id=event_id,
                    subject_type=SubjectType.USER,
                    subject_id=env.member_id,
                    role=ContentRole.BLOCKED,
                    added_by_user_id=env.admin_id,
                )
            )
        await session.execute(
            update(NotificationEmailDelivery)
            .where(
                NotificationEmailDelivery.id == request.delivery_id,
            )
            .values(scheduled_for=datetime.now(UTC) - timedelta(seconds=1))
        )
        await session.commit()
        sender = AsyncMock()
        with patch(
            "uniffy.domains.scheduling.calendar.jobs.event_mail._get_sender", return_value=sender
        ):
            result = await send_calendar_event_mail({}, str(request.delivery_id))
        assert result["status"] == NotificationEmailStatus.SKIPPED
        sender.send.assert_not_awaited()
    finally:
        await _clear(session, env, calendar_id)


@pytest.mark.parametrize("permanent", [False, True])
async def test_delete_audit_failure_rolls_back_room_and_withdrawal(session, env, permanent) -> None:
    calendar, event = await _series(session, env)
    calendar_id, event_id = calendar.id, event.id
    ops = CalendarEventOperations(session, MagicMock(spec=SearchIndexer))
    room = Room(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        name="Meeting room",
        room_type=RoomType.MEETING_ROOM,
    )
    session.add(room)
    await session.flush()
    booking = RoomBooking(
        organization_id=env.org_id,
        room_id=room.id,
        event_id=event_id,
        user_id=env.admin_id,
        start_time=event.start_time,
        end_time=event.end_time,
    )
    session.add(booking)
    await session.commit()
    booking_id = booking.id
    await _invitation_already_sent(session, env)
    try:
        with patch(
            "uniffy.domains.scheduling.calendar.events.deletion.write_audit_event",
            side_effect=RuntimeError("audit unavailable"),
        ):
            with pytest.raises(RuntimeError, match="audit unavailable"):
                await ops.delete(env.admin_id, env.org_id, event_id, permanent=permanent)
        await session.rollback()
        restored = await session.get(CalendarEvent, event_id)
        assert restored is not None and not restored.is_deleted
        assert restored.ical_sequence == 0
        assert (await session.get(RoomBooking, booking_id)).status == BookingStatus.CONFIRMED
        assert await _staged(session, env) == []
    finally:
        await _clear(session, env, calendar_id)


async def test_delete_following_stages_range_cancellation(session, env) -> None:
    calendar, event = await _series(session, env)
    calendar_id, event_id = calendar.id, event.id
    try:
        await _invitation_already_sent(session, env)
        await CalendarEventOperations(session, MagicMock(spec=SearchIndexer)).delete(
            env.admin_id,
            env.org_id,
            event_id,
            recurrence_edit_scope=RecurrenceEditScope.THIS_AND_FOLLOWING,
            occurrence_date=OCCURRENCE,
        )
        request = (await _staged(session, env))[0]
        assert request.event_id == event_id
        assert request.withdrawal.this_and_following
    finally:
        await _clear(session, env, calendar_id)


@pytest.mark.parametrize("delete_range", [False, True])
async def test_withdrawing_following_removes_moved_occurrences(session, env, delete_range) -> None:
    calendar, event = await _series(session, env)
    calendar_id, event_id = calendar.id, event.id
    ops = CalendarEventOperations(session, MagicMock(spec=SearchIndexer))
    try:
        moved = await ops.edit_single_occurrence(
            env.admin_id,
            env.org_id,
            event_id,
            OCCURRENCE,
            start_time=datetime(2026, 3, 25, 14, tzinfo=UTC),
            end_time=datetime(2026, 3, 25, 14, 30, tzinfo=UTC),
        )
        if delete_range:
            await ops.delete(
                env.admin_id,
                env.org_id,
                event_id,
                recurrence_edit_scope=RecurrenceEditScope.THIS_AND_FOLLOWING,
                occurrence_date=OCCURRENCE,
            )
        else:
            await ops.edit_this_and_following(
                env.admin_id,
                env.org_id,
                event_id,
                OCCURRENCE,
                status=EventStatus.CANCELLED,
            )
        await session.refresh(moved)
        assert moved.is_deleted
        bundle = await load_bundle(session, event_id)
        assert not bundle.exports[0].overrides
    finally:
        await _clear(session, env, calendar_id)


@pytest.mark.parametrize("single", [False, True])
async def test_tagged_scoped_edit_failure_rolls_back_event_and_mail(session, env, single) -> None:
    calendar, event = await _series(session, env)
    calendar_id, event_id = calendar.id, event.id
    ops = CalendarEventOperations(session, MagicMock(spec=SearchIndexer))
    tag = Tag(organization_id=env.org_id, name="Meeting", slug="meeting", created_by=env.admin_id)
    session.add(tag)
    await session.flush()
    session.add(
        TagAssignment(
            tag_id=tag.id,
            content_urn=event.urn,
            content_type=ContentType.CALENDAR_EVENT.value,
            sources=["manual"],
            assigned_by=env.admin_id,
        )
    )
    await session.commit()
    await _invitation_already_sent(session, env)
    tag_id = tag.id
    try:
        mutation = ops.edit_single_occurrence if single else ops.edit_this_and_following
        with patch.object(ops, "_log_activity", side_effect=RuntimeError("activity unavailable")):
            with pytest.raises(RuntimeError, match="activity unavailable"):
                await mutation(
                    env.admin_id, env.org_id, event_id, OCCURRENCE, status=EventStatus.CANCELLED
                )
        await session.rollback()
        rows = list(
            (
                await session.scalars(
                    select(CalendarEvent).where(CalendarEvent.calendar_id == calendar_id)
                )
            ).all()
        )
        assert [row.id for row in rows] == [event_id]
        assert rows[0].recurrence_config == {"interval": 1}
        assert await _staged(session, env) == []
        assignments = list(
            (
                await session.scalars(select(TagAssignment).where(TagAssignment.tag_id == tag_id))
            ).all()
        )
        assert len(assignments) == 1
    finally:
        await _clear(session, env, calendar_id)
