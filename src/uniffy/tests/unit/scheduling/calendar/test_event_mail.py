"""Event mail: one message per invite, the member's off switch, the document
each kind carries, and what the job does with the row once it sends."""

from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from icalendar import Calendar

from uniffy.core.mail import MailResult
from uniffy.core.mail.errors import MailProviderError
from uniffy.core.mail.parts import CalendarMethod
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.user import User
from uniffy.core.models.notifications.email_delivery import (
    EmailComposer,
    NotificationEmailDelivery,
    NotificationEmailStatus,
)
from uniffy.core.models.shared import DayOfWeek
from uniffy.core.types import (
    AccessMode,
    ContentType,
    NotificationType,
    RecurrencePattern,
    generate_id,
)
from uniffy.domains.notifications.delivery.outbox import (
    MAX_EMAIL_ATTEMPTS,
    NotificationEmailTerminalReason,
    RecipientContext,
    retry_email_deliveries,
)
from uniffy.domains.scheduling.calendar.jobs.event_mail import send_calendar_event_mail
from uniffy.domains.scheduling.calendar.ical.emit import (
    EventExport,
    IcalAttendee,
    IcalPerson,
)
from uniffy.domains.scheduling.calendar.mail.compose import (
    EventMailBundle,
    build_message_document,
    send_event_mail,
)
from uniffy.domains.scheduling.calendar.mail.context import (
    build_context,
    describe_recurrence,
    summarize_attendees,
)
from uniffy.domains.scheduling.calendar.mail.outbox import (
    CalendarMailKind,
    EventMailRequest,
    coalesce_metadata,
    read_event_mail,
)
from uniffy.domains.settings.defaults import (
    get_effective_notification_channels,
    wants_transactional_email,
)
from uniffy.tests.unit.core.mail.test_calendar_templates import FULL_CONTEXT
from uniffy.vendor.arq import Retry

WEDNESDAY = DayOfWeek.WEDNESDAY.value

# An invitation carries RSVP links, so composing one signs a token. The secret
# is read from the environment at call time and CI carries none.
_TEST_SECRET = "test-32-byte-secret-padding-for-event-mail-01"


@pytest.fixture(autouse=True)
def _set_jwt_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JWT_SECRET_KEY", _TEST_SECRET)


def _event(**overrides) -> CalendarEvent:
    defaults = {
        "organization_id": generate_id(),
        "organizer_id": generate_id(),
        "calendar_id": generate_id(),
        "title": "Standup",
        "start_time": datetime(2026, 3, 18, 9, tzinfo=UTC),
        "end_time": datetime(2026, 3, 18, 9, 30, tzinfo=UTC),
        "access_mode": AccessMode.OWNER_ONLY,
    }
    event = CalendarEvent(**{**defaults, **overrides})
    event.created_at = event.updated_at = datetime(2026, 1, 1, tzinfo=UTC)
    return event


def _request(event: CalendarEvent, kind: CalendarMailKind, **overrides) -> EventMailRequest:
    return EventMailRequest(
        delivery_id=overrides.get("delivery_id", generate_id()),
        organization_id=event.organization_id,
        recipient_id=overrides.get("recipient_id", generate_id()),
        event_id=event.id,
        kind=kind,
        occurrence_date=overrides.get("occurrence_date"),
        changes=overrides.get("changes", ()),
    )


def _bundle(event: CalendarEvent, **overrides) -> EventMailBundle:
    return EventMailBundle(
        event=event,
        organizer_name=overrides.get("organizer_name", "Ada Lovelace"),
        attendee_ids=overrides.get("attendee_ids", set()),
        attendee_names=overrides.get("attendee_names", ["Grace Hopper"]),
        exports=overrides.get("exports", []),
    )


def _row(event: CalendarEvent, kind: CalendarMailKind, **overrides) -> NotificationEmailDelivery:
    moment = datetime.now(UTC) - timedelta(minutes=1)
    return NotificationEmailDelivery(
        event_id=generate_id(),
        organization_id=event.organization_id,
        user_id=overrides.get("recipient_id", generate_id()),
        notification_type=NotificationType.CALENDAR_INVITE,
        title=event.title,
        content_type=ContentType.CALENDAR_EVENT,
        content_id=event.id,
        notification_metadata={
            "kind": kind.value,
            "occurrence_date": None,
            "changes": list(overrides.get("changes", [])),
        },
        frequency="instant",
        composer=EmailComposer.CALENDAR,
        coalesce_key=f"calendar:{event.id}:series:{generate_id()}",
        status=overrides.get("status", NotificationEmailStatus.PROCESSING),
        scheduled_for=moment,
        created_at=moment,
    )


def _recipient(row: NotificationEmailDelivery) -> RecipientContext:
    return RecipientContext(
        user=User(
            id=row.user_id,
            email="grace@example.com",
            username="grace",
            full_name="Grace Hopper",
            email_verified=True,
        ),
        organization=Organization(
            id=row.organization_id,
            name="Acme",
            slug=f"acme-{row.organization_id}",
        ),
        notification_overrides=None,
        timezone="Europe/Berlin",
        actor_names={},
    )


@asynccontextmanager
async def _session_context(session):
    yield session


class TestTheDoubleMailHazard:
    """Invitations and cancellations already reached the inbox as the generic
    one-line notification. Event mail replaces that path; if it merely added to
    it, every attendee would get two messages."""

    @pytest.mark.parametrize(
        "notification_type",
        [NotificationType.CALENDAR_INVITE, NotificationType.CALENDAR_CANCELLED],
    )
    def test_the_generic_notification_no_longer_sends_mail(
        self, notification_type: NotificationType
    ) -> None:
        assert get_effective_notification_channels(notification_type, None)["email"] is False

    @pytest.mark.parametrize(
        "notification_type",
        [NotificationType.CALENDAR_INVITE, NotificationType.CALENDAR_CANCELLED],
    )
    def test_in_app_notification_is_untouched(self, notification_type: NotificationType) -> None:
        assert get_effective_notification_channels(notification_type, None)["in_app"] is True

    def test_a_reminder_still_follows_its_own_preference(self) -> None:
        """Only the two types whose domain now composes its own message moved."""
        channels = get_effective_notification_channels(NotificationType.CALENDAR_REMINDER, None)

        assert channels["email"] is False  # its own default, unchanged
        assert channels["in_app"] is True


class TestTheOffSwitch:
    """Turning event mail off has to stop all of it, which means the domain
    path asks the preference itself now that the generic one is silenced."""

    def test_it_is_on_by_default(self) -> None:
        assert wants_transactional_email(NotificationType.CALENDAR_INVITE, None) is True

    def test_the_master_email_switch_stops_it(self) -> None:
        assert (
            wants_transactional_email(NotificationType.CALENDAR_INVITE, {"email_enabled": False})
            is False
        )

    def test_the_per_type_toggle_stops_it(self) -> None:
        overrides = {"channel_overrides": {"CALENDAR_INVITE": {"email": False}}}

        assert wants_transactional_email(NotificationType.CALENDAR_INVITE, overrides) is False

    def test_cancellation_has_its_own_toggle(self) -> None:
        overrides = {"channel_overrides": {"CALENDAR_CANCELLED": {"email": False}}}

        assert wants_transactional_email(NotificationType.CALENDAR_CANCELLED, overrides) is False
        assert wants_transactional_email(NotificationType.CALENDAR_INVITE, overrides) is True


class TestDocument:
    def test_an_invitation_asks_the_recipient_to_respond(self) -> None:
        event = _event()

        document = build_message_document(
            _bundle(event), _request(event, CalendarMailKind.INVITATION)
        )

        assert Calendar.from_ical(document)["method"] == CalendarMethod.REQUEST.value

    def test_an_update_is_a_fresh_request_not_its_own_method(self) -> None:
        event = _event()

        document = build_message_document(_bundle(event), _request(event, CalendarMailKind.CHANGE))

        assert Calendar.from_ical(document)["method"] == CalendarMethod.REQUEST.value

    def test_a_cancellation_withdraws_the_event(self) -> None:
        event = _event()

        document = build_message_document(
            _bundle(event), _request(event, CalendarMailKind.CANCELLATION)
        )

        assert Calendar.from_ical(document)["method"] == CalendarMethod.CANCEL.value

    def test_a_series_sends_one_message_for_the_whole_series(self) -> None:
        """One message per occurrence would be unusable mail volume."""
        event = _event(
            recurrence_pattern=RecurrencePattern.WEEKLY,
            recurrence_config={"interval": 1, "days_of_week": [WEDNESDAY]},
        )

        document = build_message_document(
            _bundle(event), _request(event, CalendarMailKind.INVITATION)
        )

        events = list(Calendar.from_ical(document).walk("VEVENT"))
        assert len(events) == 1
        assert "rrule" in events[0]

    def test_withdrawing_one_occurrence_names_only_that_occurrence(self) -> None:
        event = _event(
            recurrence_pattern=RecurrencePattern.WEEKLY,
            recurrence_config={"interval": 1, "days_of_week": [WEDNESDAY]},
        )
        request = _request(
            event, CalendarMailKind.CANCELLATION, occurrence_date=date(2026, 3, 25)
        )

        component = next(
            iter(Calendar.from_ical(build_message_document(_bundle(event), request)).walk("VEVENT"))
        )

        assert component.decoded("recurrence-id").date() == date(2026, 3, 25)
        assert "rrule" not in component

    def test_a_withdrawn_occurrence_names_the_organizer_and_the_room(self) -> None:
        """RFC 5546 wants the organizer and the affected attendees on a CANCEL;
        without them the receiving client has nothing to match its copy to."""
        event = _event()
        request = _request(
            event, CalendarMailKind.CANCELLATION, occurrence_date=date(2026, 3, 25)
        )
        bundle = _bundle(
            event,
            exports=[
                EventExport(
                    event=event,
                    organizer=IcalPerson(email="ada@example.com", name="Ada"),
                    attendees=[IcalAttendee(person=IcalPerson(email="grace@example.com"))],
                )
            ],
        )

        component = next(
            iter(Calendar.from_ical(build_message_document(bundle, request)).walk("VEVENT"))
        )

        assert "MAILTO:ada@example.com" in str(component["organizer"])
        assert "MAILTO:grace@example.com" in str(component["attendee"])

    def test_the_sequence_travels_so_clients_accept_the_update(self) -> None:
        event = _event()
        event.ical_sequence = 3

        document = build_message_document(_bundle(event), _request(event, CalendarMailKind.CHANGE))

        component = next(iter(Calendar.from_ical(document).walk("VEVENT")))
        assert int(component["sequence"]) == 3


class TestCoalescing:
    """Several edits inside the window arrive as one message, and which message
    that is depends on what happened last."""

    @staticmethod
    def _meta(kind: CalendarMailKind, *, occurrence=None, changes=()) -> dict:
        return {
            "kind": kind.value,
            "occurrence_date": occurrence,
            "changes": sorted(changes),
        }

    def test_a_cancellation_replaces_the_invitation_still_waiting(self) -> None:
        """Created then called off inside the window is one message, not two."""
        merged = coalesce_metadata(
            self._meta(CalendarMailKind.INVITATION),
            self._meta(CalendarMailKind.CANCELLATION),
        )

        assert merged["kind"] == CalendarMailKind.CANCELLATION.value

    def test_an_invitation_outranks_a_change_notice(self) -> None:
        """The invitation already states the new time the notice would repeat."""
        merged = coalesce_metadata(
            self._meta(CalendarMailKind.INVITATION),
            self._meta(CalendarMailKind.CHANGE, changes=["schedule_changed"]),
        )

        assert merged["kind"] == CalendarMailKind.INVITATION.value

    def test_an_invitation_does_not_revive_a_cancellation(self) -> None:
        merged = coalesce_metadata(
            self._meta(CalendarMailKind.CANCELLATION),
            self._meta(CalendarMailKind.INVITATION),
        )

        assert merged["kind"] == CalendarMailKind.CANCELLATION.value

    def test_every_change_survives_the_fold(self) -> None:
        merged = coalesce_metadata(
            self._meta(CalendarMailKind.CHANGE, changes=["schedule_changed"]),
            self._meta(CalendarMailKind.CHANGE, changes=["location_changed"]),
        )

        assert merged["changes"] == ["location_changed", "schedule_changed"]

    def test_the_winning_kind_decides_which_occurrence_is_named(self) -> None:
        merged = coalesce_metadata(
            self._meta(CalendarMailKind.CHANGE),
            self._meta(CalendarMailKind.CANCELLATION, occurrence="2026-03-25"),
        )

        assert merged["occurrence_date"] == "2026-03-25"


class TestReadingTheRow:
    def test_a_row_another_domain_composed_is_not_event_mail(self) -> None:
        event = _event()
        row = _row(event, CalendarMailKind.INVITATION)
        row.composer = EmailComposer.NOTIFICATION

        assert read_event_mail(row) is None

    def test_the_changes_travel_on_the_row(self) -> None:
        """Read from the row rather than the activity log: several edits fold
        onto one delivery and the union is what the message has to describe."""
        event = _event()
        row = _row(event, CalendarMailKind.CHANGE, changes=["schedule_changed"])

        request = read_event_mail(row)

        assert request is not None
        assert request.changes == ("schedule_changed",)
        assert request.kind is CalendarMailKind.CHANGE


class TestSending:
    async def _send(self, *, kind=CalendarMailKind.INVITATION):
        event = _event()
        row = _row(event, kind)
        sender = AsyncMock()
        sender.send.return_value = MailResult(success=True, provider_message_id="smtp-1")

        await send_event_mail(
            _request(event, kind, recipient_id=row.user_id),
            _bundle(event),
            _recipient(row),
            sender=sender,
        )
        return sender

    async def test_an_invitation_carries_both_the_inline_body_and_the_file(self) -> None:
        sender = await self._send()

        call = sender.send.await_args.kwargs
        assert call["calendar_part"].method is CalendarMethod.REQUEST
        assert call["attachments"][0].filename.endswith(".ics")

    async def test_the_send_is_keyed_so_a_replay_does_not_duplicate(self) -> None:
        sender = await self._send()

        assert sender.send.await_args.kwargs["idempotency_key"].startswith("calendar-mail:")


class TestTheJob:
    """One message owns one job: the claim is committed before the send, and
    the meeting and the roster are read as they stand at that moment."""

    async def _run(self, row, *, bundle, sender=None):
        session = AsyncMock()
        if sender is None:
            sender = AsyncMock()
            sender.send.return_value = MailResult(success=True, provider_message_id="smtp-1")

        with (
            patch(
                "uniffy.domains.scheduling.calendar.jobs.event_mail.open_session",
                new=lambda: _session_context(session),
            ),
            patch(
                "uniffy.domains.scheduling.calendar.jobs.event_mail.claim_email_delivery",
                new=AsyncMock(return_value=row),
            ),
            patch(
                "uniffy.domains.scheduling.calendar.jobs.event_mail.prepare_email_recipient",
                new=AsyncMock(return_value=_recipient(row)),
            ),
            patch(
                "uniffy.domains.scheduling.calendar.jobs.event_mail.load_bundle",
                new=AsyncMock(return_value=bundle),
            ),
            patch(
                "uniffy.domains.scheduling.calendar.jobs.event_mail._get_sender",
                return_value=sender,
            ),
        ):
            result = await send_calendar_event_mail({}, str(row.id))
        return result, sender, session

    async def test_it_sends_and_settles_the_row(self) -> None:
        event = _event()
        row = _row(event, CalendarMailKind.INVITATION)
        bundle = _bundle(event, attendee_ids={row.user_id})

        result, sender, session = await self._run(row, bundle=bundle)

        assert result["status"] == NotificationEmailStatus.SENT
        assert row.provider_message_id == "smtp-1"
        sender.send.assert_awaited_once()
        session.commit.assert_awaited()

    async def test_somebody_uninvited_while_the_message_waited_gets_nothing(self) -> None:
        event = _event()
        row = _row(event, CalendarMailKind.INVITATION)
        bundle = _bundle(event, attendee_ids={generate_id()})

        result, sender, _ = await self._run(row, bundle=bundle)

        assert result["reason"] == NotificationEmailTerminalReason.ACCESS_REVOKED.value
        assert row.status == NotificationEmailStatus.SKIPPED
        sender.send.assert_not_awaited()

    async def test_a_cancellation_still_reaches_somebody_off_the_roster(self) -> None:
        """The roster is how you know an invitation is still owed; a withdrawal
        is owed to whoever was told about the meeting."""
        event = _event()
        row = _row(event, CalendarMailKind.CANCELLATION)
        bundle = _bundle(event, attendee_ids=set())

        result, sender, _ = await self._run(row, bundle=bundle)

        assert result["status"] == NotificationEmailStatus.SENT
        sender.send.assert_awaited_once()

    async def test_a_meeting_erased_outright_settles_the_row(self) -> None:
        event = _event()
        row = _row(event, CalendarMailKind.CHANGE)

        result, sender, _ = await self._run(row, bundle=None)

        assert row.status == NotificationEmailStatus.SKIPPED
        assert result["status"] == "skipped"
        sender.send.assert_not_awaited()

    async def test_a_recipient_the_shared_checks_refuse_is_not_sent_to(self) -> None:
        event = _event()
        row = _row(event, CalendarMailKind.INVITATION)
        row.status = NotificationEmailStatus.SKIPPED
        row.terminal_reason = NotificationEmailTerminalReason.PREFERENCE_DISABLED.value

        result, sender, _ = await self._run(row, bundle=_bundle(event, attendee_ids={row.user_id}))

        assert result["reason"] == NotificationEmailTerminalReason.PREFERENCE_DISABLED.value
        sender.send.assert_not_awaited()

    async def test_a_provider_failure_leaves_the_row_for_the_next_pass(self) -> None:
        event = _event()
        row = _row(event, CalendarMailKind.INVITATION)
        sender = AsyncMock()
        sender.send.side_effect = MailProviderError("temporary failure")

        with pytest.raises(Retry):
            await self._run(
                row,
                bundle=_bundle(event, attendee_ids={row.user_id}),
                sender=sender,
            )

        assert row.status == NotificationEmailStatus.PENDING


class TestRetry:
    def test_a_failure_under_the_ceiling_stays_pending(self) -> None:
        event = _event()
        row = _row(event, CalendarMailKind.INVITATION)
        row.attempt_count = 1

        delay = retry_email_deliveries([row], attempt=1, now=datetime.now(UTC))

        assert delay is not None
        assert row.status == NotificationEmailStatus.PENDING

    def test_a_failure_at_the_ceiling_is_terminal(self) -> None:
        event = _event()
        row = _row(event, CalendarMailKind.INVITATION)
        row.attempt_count = MAX_EMAIL_ATTEMPTS

        delay = retry_email_deliveries([row], attempt=1, now=datetime.now(UTC))

        assert delay is None
        assert row.status == NotificationEmailStatus.FAILED
        assert row.terminal_reason == NotificationEmailTerminalReason.DELIVERY_FAILED.value


class TestContext:
    def test_it_supplies_every_key_the_templates_reference(self) -> None:
        """The mail environment is strict, so a key the builder forgets raises
        inside the job, after the transaction has already committed."""
        context = build_context(
            _event(),
            organization_name="Acme",
            organizer_name="Ada Lovelace",
            recipient_timezone="Europe/Berlin",
        )

        assert set(context) == set(FULL_CONTEXT)

    def test_the_action_link_is_a_route_the_app_serves(self) -> None:
        """The app routes /calendar/:eventId; a link the router does not match
        renders the 404 page, and mail is the one surface nobody can fix after
        it has been sent."""
        event = _event()

        context = build_context(
            event,
            organization_name="Acme",
            organizer_name="Ada",
            recipient_timezone="UTC",
        )

        assert context["action_url"].endswith(f"/calendar/{event.id}")

    def test_times_render_in_the_recipients_zone(self) -> None:
        context = build_context(
            _event(),
            organization_name="Acme",
            organizer_name="Ada",
            recipient_timezone="Asia/Tokyo",
        )

        # 09:00 UTC is 18:00 in Tokyo.
        assert "18:00" in context["when"]
        assert context["timezone_label"] == "Asia/Tokyo"

    def test_an_all_day_event_states_no_clock_time(self) -> None:
        event = _event(
            start_time=datetime(2026, 3, 18, tzinfo=UTC),
            end_time=datetime(2026, 3, 19, tzinfo=UTC),
            is_all_day=True,
        )

        context = build_context(
            event, organization_name="Acme", organizer_name="Ada", recipient_timezone="UTC"
        )

        assert "all day" in context["when"]

    def test_an_occurrence_keeps_the_meetings_own_wall_clock(self) -> None:
        """A New York series set up in winter still starts at 09:00 there in
        July; resolving the date in the reader's zone drifts it by an hour."""
        event = _event(
            start_time=datetime(2026, 1, 14, 14, tzinfo=UTC),
            end_time=datetime(2026, 1, 14, 14, 30, tzinfo=UTC),
            timezone="America/New_York",
        )

        context = build_context(
            event,
            organization_name="Acme",
            organizer_name="Ada",
            recipient_timezone="UTC",
            occurrence_date=date(2026, 7, 15),
        )

        assert "13:00" in context["when"]

    def test_an_all_day_event_keeps_its_date_for_every_reader(self) -> None:
        """All-day carries a date, not an instant: converting it moves the day
        back for anyone west of the organizer."""
        event = _event(
            start_time=datetime(2026, 3, 18, tzinfo=UTC),
            end_time=datetime(2026, 3, 19, tzinfo=UTC),
            is_all_day=True,
        )

        context = build_context(
            event,
            organization_name="Acme",
            organizer_name="Ada",
            recipient_timezone="America/Los_Angeles",
        )

        assert "18 March 2026" in context["when"]

    @pytest.mark.parametrize(
        ("pattern", "config", "expected"),
        [
            (RecurrencePattern.NONE, None, ""),
            (
                RecurrencePattern.WEEKLY,
                {"interval": 1, "days_of_week": [WEDNESDAY]},
                "Repeats every week on Wednesday",
            ),
            (RecurrencePattern.DAILY, {"interval": 3}, "Repeats every 3 days"),
            (
                RecurrencePattern.BIWEEKLY,
                {"interval": 1, "days_of_week": [WEDNESDAY]},
                "Repeats every two weeks on Wednesday",
            ),
            (RecurrencePattern.MONTHLY, {"interval": 1}, "Repeats every month"),
        ],
    )
    def test_recurrence_reads_as_a_sentence(
        self, pattern: RecurrencePattern, config: dict | None, expected: str
    ) -> None:
        event = _event(recurrence_pattern=pattern, recurrence_config=config)

        assert describe_recurrence(event) == expected

    @pytest.mark.parametrize(
        ("names", "expected"),
        [
            ([], ""),
            (["Ada"], "Ada"),
            (["Ada", "Grace"], "Ada and Grace"),
            (["Ada", "Grace", "Alan"], "Ada, Grace and Alan"),
            (["Ada", "Grace", "Alan", "Edsger"], "Ada, Grace, Alan and 1 other"),
            (["Ada", "Grace", "Alan", "Edsger", "Barbara"], "Ada, Grace, Alan and 2 others"),
        ],
    )
    def test_a_long_roster_is_summarised(self, names: list[str], expected: str) -> None:
        assert summarize_attendees(names) == expected
