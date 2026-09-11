"""Event mail: one message per invite, the member's off switch, and the
document each kind carries."""

from datetime import UTC, date, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from icalendar import Calendar

from uniffy.core.mail.parts import CalendarMethod
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.mail_delivery import (
    CalendarMailDelivery,
    CalendarMailKind,
    CalendarMailStatus,
)
from uniffy.core.models.shared import DayOfWeek
from uniffy.core.types import (
    AccessMode,
    NotificationType,
    RecurrencePattern,
    generate_id,
)
from uniffy.domains.scheduling.calendar.mail.compose import (
    EventMailBundle,
    build_message_document,
    send_delivery,
)
from uniffy.domains.scheduling.calendar.mail.context import (
    build_context,
    describe_recurrence,
    summarize_attendees,
)
from uniffy.domains.scheduling.calendar.mail.outbox import MAX_ATTEMPTS, mark_failed
from uniffy.domains.settings.defaults import (
    get_effective_notification_channels,
    wants_transactional_email,
)
from uniffy.tests.unit.core.mail.test_calendar_templates import FULL_CONTEXT

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


def _bundle(event: CalendarEvent, **overrides) -> EventMailBundle:
    organization = MagicMock()
    organization.name = "Acme"
    return EventMailBundle(
        event=event,
        organization=organization,
        organizer_name=overrides.get("organizer_name", "Ada Lovelace"),
        attendee_names=overrides.get("attendee_names", ["Grace Hopper"]),
        exports=overrides.get("exports", []),
    )


def _delivery(event: CalendarEvent, kind: CalendarMailKind, **overrides) -> CalendarMailDelivery:
    return CalendarMailDelivery(
        organization_id=event.organization_id,
        event_id=event.id,
        recipient_user_id=overrides.get("recipient_user_id", generate_id()),
        kind=kind,
        status=CalendarMailStatus.PENDING,
        occurrence_date=overrides.get("occurrence_date"),
        scheduled_for=datetime(2026, 3, 17, tzinfo=UTC),
    )


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
    def test_in_app_notification_is_untouched(
        self, notification_type: NotificationType
    ) -> None:
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
            wants_transactional_email(
                NotificationType.CALENDAR_INVITE, {"email_enabled": False}
            )
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

        document = build_message_document(_bundle(event), _delivery(event, CalendarMailKind.INVITATION))

        assert Calendar.from_ical(document)["method"] == CalendarMethod.REQUEST.value

    def test_an_update_is_a_fresh_request_not_its_own_method(self) -> None:
        event = _event()

        document = build_message_document(_bundle(event), _delivery(event, CalendarMailKind.CHANGE))

        assert Calendar.from_ical(document)["method"] == CalendarMethod.REQUEST.value

    def test_a_cancellation_withdraws_the_event(self) -> None:
        event = _event()

        document = build_message_document(
            _bundle(event), _delivery(event, CalendarMailKind.CANCELLATION)
        )

        assert Calendar.from_ical(document)["method"] == CalendarMethod.CANCEL.value

    def test_a_series_sends_one_message_for_the_whole_series(self) -> None:
        """One message per occurrence would be unusable mail volume."""
        event = _event(
            recurrence_pattern=RecurrencePattern.WEEKLY,
            recurrence_config={"interval": 1, "days_of_week": [WEDNESDAY]},
        )

        document = build_message_document(
            _bundle(event), _delivery(event, CalendarMailKind.INVITATION)
        )

        events = list(Calendar.from_ical(document).walk("VEVENT"))
        assert len(events) == 1
        assert "rrule" in events[0]

    def test_withdrawing_one_occurrence_names_only_that_occurrence(self) -> None:
        event = _event(
            recurrence_pattern=RecurrencePattern.WEEKLY,
            recurrence_config={"interval": 1, "days_of_week": [WEDNESDAY]},
        )
        delivery = _delivery(
            event, CalendarMailKind.CANCELLATION, occurrence_date=date(2026, 3, 25)
        )

        component = next(
            iter(Calendar.from_ical(build_message_document(_bundle(event), delivery)).walk("VEVENT"))
        )

        assert component.decoded("recurrence-id").date() == date(2026, 3, 25)
        assert "rrule" not in component

    def test_the_sequence_travels_so_clients_accept_the_update(self) -> None:
        event = _event()
        event.ical_sequence = 3

        document = build_message_document(_bundle(event), _delivery(event, CalendarMailKind.CHANGE))

        component = next(iter(Calendar.from_ical(document).walk("VEVENT")))
        assert int(component["sequence"]) == 3


class TestSending:
    async def _send(self, *, overrides=None, active=True, kind=CalendarMailKind.INVITATION):
        event = _event()
        delivery = _delivery(event, kind)
        recipient = MagicMock()
        recipient.id = delivery.recipient_user_id
        recipient.email = "grace@example.com"
        recipient.is_active = active
        session = MagicMock()
        session.get = AsyncMock(return_value=recipient)
        sender = MagicMock()
        sender.send = AsyncMock()

        delivered = await send_delivery(
            session,
            delivery,
            _bundle(event),
            sender=sender,
            overrides_loader=AsyncMock(return_value=overrides),
            timezone_loader=AsyncMock(return_value="Europe/Berlin"),
        )
        return delivered, sender

    async def test_an_invitation_carries_both_the_inline_body_and_the_file(self) -> None:
        delivered, sender = await self._send()

        assert delivered
        call = sender.send.await_args.kwargs
        assert call["calendar_part"].method is CalendarMethod.REQUEST
        assert call["attachments"][0].filename.endswith(".ics")

    async def test_a_member_who_turned_event_mail_off_gets_nothing(self) -> None:
        delivered, sender = await self._send(overrides={"email_enabled": False})

        assert not delivered
        sender.send.assert_not_awaited()

    async def test_a_deactivated_recipient_gets_nothing(self) -> None:
        delivered, sender = await self._send(active=False)

        assert not delivered
        sender.send.assert_not_awaited()

    async def test_the_send_is_keyed_so_a_replay_does_not_duplicate(self) -> None:
        _, sender = await self._send()

        assert sender.send.await_args.kwargs["idempotency_key"].startswith("calendar-mail:")


class TestRetry:
    async def test_a_failure_under_the_ceiling_stays_pending(self) -> None:
        event = _event()
        delivery = _delivery(event, CalendarMailKind.INVITATION)
        delivery.attempts = 1

        await mark_failed(MagicMock(), [delivery], datetime.now(UTC), "smtp refused")

        assert delivery.status is CalendarMailStatus.PENDING
        assert delivery.last_error == "smtp refused"

    async def test_a_failure_at_the_ceiling_is_terminal(self) -> None:
        event = _event()
        delivery = _delivery(event, CalendarMailKind.INVITATION)
        delivery.attempts = MAX_ATTEMPTS

        await mark_failed(MagicMock(), [delivery], datetime.now(UTC), "smtp refused")

        assert delivery.status is CalendarMailStatus.FAILED


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
        assert describe_recurrence(_event(recurrence_pattern=pattern, recurrence_config=config)) == expected

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
