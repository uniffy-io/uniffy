"""Status, visibility, transparency, and out-of-office behavior."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.types import (
    ContentRole,
    EventStatus,
    EventTransparency,
    EventVisibility,
    generate_id,
)
from uniffy.domains.scheduling.calendar.converters import event_to_proto
from uniffy.domains.scheduling.calendar.operations import (
    CalendarEventOperations,
    _activity_value,
    event_details_hidden,
)


def _event(**overrides) -> CalendarEvent:
    defaults = dict(
        organization_id=generate_id(),
        organizer_id=generate_id(),
        calendar_id=generate_id(),
        title="Quarterly review",
        description="Numbers and [[[notes|urn:uniffy:content:NOTE:x]]]",
        start_time=datetime(2026, 9, 1, 10, tzinfo=UTC),
        end_time=datetime(2026, 9, 1, 11, tzinfo=UTC),
        location="Room 4",
        meeting_url="https://meet.example/xyz",
    )
    defaults.update(overrides)
    return CalendarEvent(**defaults)


class TestEventDetailsHidden:
    def test_standard_event_is_never_hidden(self) -> None:
        event = _event()
        assert not event_details_hidden(event, generate_id(), None, is_attendee=False)

    def test_private_event_hidden_from_plain_viewer(self) -> None:
        event = _event(visibility=EventVisibility.PRIVATE)
        assert event_details_hidden(event, generate_id(), ContentRole.VIEWER, is_attendee=False)

    def test_private_event_visible_to_organizer(self) -> None:
        event = _event(visibility=EventVisibility.PRIVATE)
        assert not event_details_hidden(event, event.organizer_id, ContentRole.OWNER, False)

    def test_private_event_visible_to_attendee(self) -> None:
        event = _event(visibility=EventVisibility.PRIVATE)
        assert not event_details_hidden(event, generate_id(), ContentRole.VIEWER, is_attendee=True)

    def test_private_event_visible_to_explicit_editor(self) -> None:
        event = _event(visibility=EventVisibility.PRIVATE)
        assert not event_details_hidden(event, generate_id(), ContentRole.EDITOR, is_attendee=False)

    def test_private_event_hidden_without_any_role(self) -> None:
        event = _event(visibility=EventVisibility.PRIVATE)
        assert event_details_hidden(event, generate_id(), None, is_attendee=False)


class TestEventProtoRedaction:
    def test_redacted_proto_keeps_only_busy_fields(self) -> None:
        event = _event(
            visibility=EventVisibility.PRIVATE,
            is_out_of_office=True,
            category_id=generate_id(),
        )
        proto = event_to_proto(event, details_hidden=True)

        assert proto.details_hidden is True
        assert proto.title == ""
        assert proto.description == ""
        assert proto.location == ""
        assert proto.category_id == ""
        assert not proto.has_field("meeting_url")
        assert not proto.has_field("channel_id")
        assert len(proto.attendees) == 0
        assert len(proto.outgoing_references) == 0
        assert proto.is_out_of_office is True
        assert proto.start_time.seconds > 0
        assert proto.end_time.seconds > 0

    def test_unredacted_proto_carries_the_new_states(self) -> None:
        event = _event(
            status=EventStatus.TENTATIVE,
            transparency=EventTransparency.TRANSPARENT,
        )
        proto = event_to_proto(event)

        assert proto.details_hidden is False
        assert proto.title == "Quarterly review"
        from uniffy_proto.cal.v1.calendar_pb import (
            EventStatus as ProtoEventStatus,
        )
        from uniffy_proto.cal.v1.calendar_pb import (
            EventTransparency as ProtoEventTransparency,
        )
        from uniffy_proto.cal.v1.calendar_pb import (
            EventVisibility as ProtoEventVisibility,
        )

        assert proto.status == ProtoEventStatus.TENTATIVE
        assert proto.visibility == ProtoEventVisibility.STANDARD
        assert proto.transparency == ProtoEventTransparency.TRANSPARENT


class TestSearchMetadata:
    def test_metadata_carries_status_and_visibility(self) -> None:
        ops = CalendarEventOperations.__new__(CalendarEventOperations)
        event = _event(visibility=EventVisibility.PRIVATE, status=EventStatus.CANCELLED)
        metadata = ops._get_search_metadata(event)
        assert metadata is not None
        assert metadata["event_status"] == "CANCELLED"
        assert metadata["visibility"] == "PRIVATE"


class TestCancelledRsvp:
    async def test_rsvp_refused_on_cancelled_event(self) -> None:
        from uniffy.core.types import AttendeeStatus

        ops = CalendarEventOperations.__new__(CalendarEventOperations)
        cancelled = _event(status=EventStatus.CANCELLED)
        ops._fetch_by_id = AsyncMock(return_value=cancelled)
        ops._require_view = AsyncMock()
        ops.session = MagicMock()

        with pytest.raises(ValidationError):
            await ops.update_attendee_status(
                generate_id(),
                cancelled.organization_id,
                cancelled.id,
                AttendeeStatus.ACCEPTED,
            )


class TestActivityValues:
    def test_enum_values_render_as_their_wire_value(self) -> None:
        assert _activity_value(EventStatus.CANCELLED) == "CANCELLED"
        assert _activity_value(EventTransparency.OPAQUE) == "OPAQUE"
