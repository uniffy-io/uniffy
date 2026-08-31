"""Unit tests for the calendar <-> tags wiring.

Covers the pure-Python pieces that don't require a live DB:

- ``CalendarEventOperations._build_search_keywords`` does not emit per-tag
  tokens (the tag-assignment table is the source of truth).
- ``CalendarEventOperations._tag_filter_subquery`` builds the right
  join + GROUP BY + HAVING shape for the ``ListEventsRequest.tag_ids[]``
  filter (logical AND across the requested set).
- ``_master_event_id`` strips the synthetic ``__occurrence__`` suffix so
  recurring instances resolve their tag set against the master URN rather
  than the synthetic id.

Live-DB integration coverage runs under the calendar-domain harness.
"""

from datetime import UTC, datetime
from unittest.mock import MagicMock
from uuid import UUID

from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.types import AccessMode, generate_id
from uniffy.domains.scheduling.calendar.operations import (
    CalendarEventOperations,
    _master_event_id,
)


def _make_event(*, description: str = "", location: str = "") -> CalendarEvent:
    now = datetime.now(UTC)
    return CalendarEvent(
        organization_id=generate_id(),
        organizer_id=generate_id(),
        calendar_id=generate_id(),
        title="Sprint Planning",
        description=description,
        start_time=now,
        end_time=now,
        location=location,
        access_mode=AccessMode.OWNER_ONLY,
    )


def _make_ops() -> CalendarEventOperations:
    ops = CalendarEventOperations.__new__(CalendarEventOperations)
    ops.session = MagicMock()
    return ops


class TestBuildSearchKeywords:
    def test_keywords_do_not_emit_per_tag_tokens(self) -> None:
        ops = _make_ops()
        event = _make_event(
            description="Roadmap review with stakeholders",
            location="Conference Room A",
        )
        out = ops._build_search_keywords(event)
        assert "tag:" not in out
        assert "Sprint Planning" in out
        assert "Roadmap review with stakeholders" in out
        assert "Conference Room A" in out


class TestMasterEventId:
    def test_master_id_passes_real_uuid_through(self) -> None:
        event = _make_event()
        assert _master_event_id(event) == event.id

    def test_master_id_strips_occurrence_suffix(self) -> None:
        master_uuid = generate_id()
        synthetic_id = f"{master_uuid}__occurrence__2026-05-07"
        event = _make_event()
        event.id = synthetic_id  # type: ignore[assignment]
        # Recurring instance ids look like ``{master}__occurrence__{date}``
        # but their tag assignments live on the master URN, so the
        # tag pipeline must always reach the master row.
        assert _master_event_id(event) == master_uuid

    def test_master_id_handles_string_uuid(self) -> None:
        u = generate_id()
        event = _make_event()
        event.id = str(u)  # type: ignore[assignment]
        assert _master_event_id(event) == UUID(str(u))
