"""Bounds a range request has to satisfy before the calendar reads anything."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.types import generate_id
from uniffy.domains.scheduling.calendar.events.recurrence.queries import (
    MAX_RANGE_DAYS,
    RecurrenceQueryOperations,
)

START = datetime(2026, 9, 7, tzinfo=UTC)


class _ReachedTheQuery(Exception):
    """Raised from the first collaborator a validated request would consult."""


def _operations() -> RecurrenceQueryOperations:
    return RecurrenceQueryOperations(MagicMock())


async def test_range_wider_than_the_cap_is_refused_before_any_query() -> None:
    operations = _operations()

    with pytest.raises(ValidationError):
        await operations.get_events_in_range(
            generate_id(),
            generate_id(),
            START,
            START + timedelta(days=MAX_RANGE_DAYS + 1),
        )

    operations.session.execute.assert_not_called()


async def test_inverted_range_is_refused_before_any_query() -> None:
    operations = _operations()

    with pytest.raises(ValidationError):
        await operations.get_events_in_range(
            generate_id(),
            generate_id(),
            START,
            START - timedelta(days=1),
        )

    operations.session.execute.assert_not_called()


async def test_range_exactly_at_the_cap_is_accepted() -> None:
    operations = _operations()
    operations.access_query.build_accessible_filter = AsyncMock(side_effect=_ReachedTheQuery)

    with pytest.raises(_ReachedTheQuery):
        await operations.get_events_in_range(
            generate_id(),
            generate_id(),
            START,
            START + timedelta(days=MAX_RANGE_DAYS),
        )
