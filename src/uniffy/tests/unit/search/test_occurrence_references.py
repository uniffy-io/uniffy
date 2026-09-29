from datetime import UTC, date, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.search.workspace import WorkspaceSearch
from uniffy.core.types import ContentType, generate_id
from uniffy.domains.scheduling.calendar.occurrences import OccurrenceReference, OccurrenceTarget
from uniffy.domains.search import occurrences
from uniffy.domains.search.operations import SearchOperations, _build_reference_result
from uniffy.domains.search.queries import UrnAvailability


@pytest.mark.parametrize(
    "availability",
    [UrnAvailability.RESTRICTED, UrnAvailability.DELETED, UrnAvailability.UNAVAILABLE],
)
async def test_inaccessible_series_never_loads_occurrences(monkeypatch, availability) -> None:
    org = generate_id()
    ref = OccurrenceReference(generate_id(), date(2026, 9, 28))
    master_urn = f"urn:uniffy:content:CALENDAR_EVENT:{ref.event_id}"
    urn = f"urn:uniffy:content:CALENDAR_EVENT:{ref.id}"
    resolver = SearchOperations(MagicMock(), MagicMock(spec=WorkspaceSearch))
    resolver._resolve_resource_urns = AsyncMock(
        return_value={master_urn: _build_reference_result(master_urn, org, availability)}
    )
    loader = AsyncMock()
    monkeypatch.setattr(occurrences, "load_occurrence_targets", loader)

    result = (await resolver.resolve_urns(generate_id(), org, [urn]))[urn]

    assert result.availability == availability
    assert result.title == ""
    assert result.metadata is None
    assert not result.can_request_access
    loader.assert_not_awaited()


async def test_occurrences_reuse_authorized_preview_with_independent_dates(monkeypatch) -> None:
    org, user = generate_id(), generate_id()
    refs = [OccurrenceReference(generate_id(), date(2026, 9, 28))]
    refs.append(OccurrenceReference(refs[0].event_id, date(2026, 9, 29)))
    master_urn = f"urn:uniffy:content:CALENDAR_EVENT:{refs[0].event_id}"
    urns = [f"urn:uniffy:content:CALENDAR_EVENT:{ref.id}" for ref in refs]
    master = _build_reference_result(master_urn, org, UrnAvailability.AVAILABLE)
    master.title = "Standup"
    master.event_start_time = "2026-09-21T06:00:00+00:00"
    resolver = SearchOperations(MagicMock(), MagicMock(spec=WorkspaceSearch))
    resolver._resolve_resource_urns = AsyncMock(return_value={master_urn: master})
    monkeypatch.setattr(
        occurrences,
        "load_occurrence_targets",
        AsyncMock(
            return_value={
                ref: OccurrenceTarget(
                    ref.event_id,
                    datetime(2026, 9, ref.occurrence_date.day, 6, tzinfo=UTC),
                    datetime(2026, 9, ref.occurrence_date.day, 6, 30, tzinfo=UTC),
                )
                for ref in refs
            }
        ),
    )

    result = await resolver.resolve_urns(user, org, [master_urn, *urns])

    assert result[urns[0]].event_start_time == "2026-09-28T06:00:00+00:00"
    assert result[urns[1]].event_start_time == "2026-09-29T06:00:00+00:00"
    assert result[urns[0]].url_path == f"/calendar?event={refs[0].id}"
    assert result[master_urn].event_start_time == "2026-09-21T06:00:00+00:00"
    resolver._resolve_resource_urns.assert_awaited_once_with(user, org, [master_urn])


@pytest.mark.parametrize(
    "override_state",
    [UrnAvailability.AVAILABLE, UrnAvailability.RESTRICTED, UrnAvailability.DELETED],
)
async def test_rescheduled_occurrence_requires_independent_override_resolution(
    monkeypatch, override_state
) -> None:
    org, user = generate_id(), generate_id()
    ref = OccurrenceReference(generate_id(), date(2026, 9, 28))
    override_id = generate_id()
    master_urn = f"urn:uniffy:content:CALENDAR_EVENT:{ref.event_id}"
    override_urn = f"urn:uniffy:content:CALENDAR_EVENT:{override_id}"
    urn = f"urn:uniffy:content:CALENDAR_EVENT:{ref.id}"
    override = _build_reference_result(override_urn, org, override_state)
    if override_state == UrnAvailability.AVAILABLE:
        override.title = "Rescheduled"
        override.url_path = f"/calendar?event={override_id}"
    resolver = SearchOperations(MagicMock(), MagicMock(spec=WorkspaceSearch))
    resolver._resolve_resource_urns = AsyncMock(
        side_effect=[
            {master_urn: _build_reference_result(master_urn, org, UrnAvailability.AVAILABLE)},
            {override_urn: override},
        ]
    )
    monkeypatch.setattr(
        occurrences,
        "load_occurrence_targets",
        AsyncMock(return_value={ref: OccurrenceTarget(override_id)}),
    )

    result = (await resolver.resolve_urns(user, org, [urn]))[urn]

    assert result.availability == override_state
    assert result.title == override.title
    assert result.url_path == override.url_path
    resolver._resolve_resource_urns.assert_any_await(user, org, [override_urn])


@pytest.mark.parametrize("failure", [False, True])
async def test_cancelled_occurrence_is_deleted_but_lookup_failure_is_unavailable(
    monkeypatch, failure
) -> None:
    org = generate_id()
    ref = OccurrenceReference(generate_id(), date(2026, 9, 28))
    master_urn = f"urn:uniffy:content:CALENDAR_EVENT:{ref.event_id}"
    urn = f"urn:uniffy:content:CALENDAR_EVENT:{ref.id}"
    resolver = SearchOperations(MagicMock(), MagicMock(spec=WorkspaceSearch))
    resolver._resolve_resource_urns = AsyncMock(
        return_value={
            master_urn: _build_reference_result(master_urn, org, UrnAvailability.AVAILABLE)
        }
    )
    loader = (
        AsyncMock(side_effect=RuntimeError("Database unavailable"))
        if failure
        else AsyncMock(return_value={ref: None})
    )
    monkeypatch.setattr(occurrences, "load_occurrence_targets", loader)

    result = (await resolver.resolve_urns(generate_id(), org, [urn]))[urn]

    assert result.availability == (
        UrnAvailability.UNAVAILABLE if failure else UrnAvailability.DELETED
    )
    assert result.title == ""
    assert result.url_path == ""
    assert result.entity_type == ContentType.CALENDAR_EVENT.value.lower()
