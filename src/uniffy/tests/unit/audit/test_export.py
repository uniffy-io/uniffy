"""Streaming audit-event export tests."""

import csv
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.json_codec import loads
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.types import generate_id
from uniffy.domains.audit.export import (
    CSV_COLUMNS,
    MAX_EXPORT_ROWS,
    ExportFilter,
    ExportOperations,
)
from uniffy.domains.audit.operations import ListEventsFilter


def _make_event(**overrides) -> AuditEvent:
    base = {
        "id": generate_id(),
        "organization_id": generate_id(),
        "actor_user_id": generate_id(),
        "actor_org_role": "ADMIN",
        "action": "note.deleted",
        "resource_type": "NOTE",
        "resource_id": generate_id(),
        "details": {"reason": "cleanup"},
        "ip_address": "127.0.0.1",
        "user_agent": "pytest",
        "created_at": datetime(2026, 5, 20, 12, 0, 0, tzinfo=UTC),
    }
    base.update(overrides)
    return AuditEvent(**base)


def _scalar(value):
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    result.scalar_one.return_value = value
    return result


def _rows(rows):
    result = MagicMock()
    result.scalars.return_value.all.return_value = list(rows)
    return result


def _emails(pairs):
    result = MagicMock()
    result.all.return_value = list(pairs)
    return result


def _admin_session(*, count: int, batches: list[list[AuditEvent]]):
    session = MagicMock()
    side_effects: list = [_scalar(count)]
    for batch in batches:
        side_effects.append(_rows(batch))
        if batch:
            side_effects.append(_emails([]))
    side_effects.append(_rows([]))
    session.execute = AsyncMock(side_effect=side_effects)
    return session


def _auth(role: OrganizationRole | None = None, *, support: bool = False):
    membership = SimpleNamespace(role=role) if role is not None else None
    return patch.multiple(
        "uniffy.domains.audit.operations",
        get_active_membership=AsyncMock(return_value=membership),
        get_active_support_access=AsyncMock(return_value=MagicMock() if support else None),
    )


async def _collect_csv(ops: ExportOperations, filter_: ListEventsFilter) -> bytes:
    payload = bytearray()
    async for chunk in ops.stream_export(generate_id(), ExportFilter(filter=filter_, format="csv")):
        payload.extend(chunk)
    return bytes(payload)


async def _collect_ndjson(ops: ExportOperations, filter_: ListEventsFilter) -> bytes:
    payload = bytearray()
    async for chunk in ops.stream_export(
        generate_id(), ExportFilter(filter=filter_, format="ndjson")
    ):
        payload.extend(chunk)
    return bytes(payload)


async def test_csv_starts_with_header_row_in_canonical_order() -> None:
    session = _admin_session(count=0, batches=[[]])
    ops = ExportOperations(session)
    with _auth(OrganizationRole.ADMIN):
        output = await _collect_csv(ops, ListEventsFilter(organization_id=generate_id()))
    # Empty result: a header row is still emitted.
    first_line = output.decode("utf-8").splitlines()[0]
    reader = csv.reader([first_line])
    assert tuple(next(reader)) == CSV_COLUMNS


async def test_csv_serialises_an_event_row_into_the_expected_columns() -> None:
    event = _make_event()
    session = _admin_session(count=1, batches=[[event]])
    ops = ExportOperations(session)
    with _auth(OrganizationRole.ADMIN):
        output = await _collect_csv(ops, ListEventsFilter(organization_id=event.organization_id))

    lines = output.decode("utf-8").splitlines()
    assert lines[0].split(",")[0] == "timestamp_utc"

    data_rows = list(csv.reader(lines[1:]))
    assert len(data_rows) == 1
    row = dict(zip(CSV_COLUMNS, data_rows[0], strict=True))
    assert row["organization_id"] == str(event.organization_id)
    assert row["action"] == event.action
    assert row["resource_type"] == event.resource_type
    assert row["resource_id"] == str(event.resource_id)
    assert row["actor_org_role"] == "ADMIN"
    assert row["ip_address"] == "127.0.0.1"
    assert loads(row["details_json"]) == {"reason": "cleanup"}


async def test_ndjson_emits_one_json_object_per_line_with_parsed_details() -> None:
    event = _make_event()
    session = _admin_session(count=1, batches=[[event]])
    ops = ExportOperations(session)
    with _auth(OrganizationRole.ADMIN):
        output = await _collect_ndjson(ops, ListEventsFilter(organization_id=event.organization_id))

    lines = [line for line in output.decode("utf-8").splitlines() if line]
    assert len(lines) == 1
    payload = loads(lines[0])
    assert payload["action"] == event.action
    assert payload["resource_id"] == str(event.resource_id)
    assert payload["details"] == {"reason": "cleanup"}
    assert payload["actor_org_role"] == "ADMIN"


async def test_row_cap_blocks_filters_that_would_dump_too_many_rows() -> None:
    session = MagicMock()
    session.execute = AsyncMock(
        side_effect=[
            _scalar(MAX_EXPORT_ROWS + 1),
        ]
    )
    ops = ExportOperations(session)

    async def _run() -> None:
        async for _ in ops.stream_export(
            generate_id(),
            ExportFilter(
                filter=ListEventsFilter(organization_id=generate_id()),
                format="csv",
            ),
        ):
            return

    with _auth(OrganizationRole.ADMIN), pytest.raises(ValidationError):
        await _run()


async def test_regular_member_denied_before_export_begins() -> None:
    session = MagicMock()
    session.execute = AsyncMock()
    ops = ExportOperations(session)

    async def _run() -> None:
        async for _ in ops.stream_export(
            generate_id(),
            ExportFilter(
                filter=ListEventsFilter(organization_id=generate_id()),
                format="csv",
            ),
        ):
            return

    with _auth(OrganizationRole.MEMBER), pytest.raises(PermissionDeniedError):
        await _run()


async def test_system_admin_cannot_export_without_a_support_session() -> None:
    session = MagicMock()
    session.execute = AsyncMock()
    ops = ExportOperations(session)

    async def _run() -> None:
        async for _ in ops.stream_export(
            generate_id(),
            ExportFilter(
                filter=ListEventsFilter(organization_id=generate_id()),
                format="csv",
            ),
        ):
            return

    with _auth(), pytest.raises(PermissionDeniedError):
        await _run()


async def test_system_admin_exports_through_an_active_support_session() -> None:
    event = _make_event()
    session = MagicMock()
    session.execute = AsyncMock(
        side_effect=[
            _scalar(1),  # row count
            _rows([event]),
            _emails([]),
            _rows([]),
        ]
    )
    ops = ExportOperations(session)

    with _auth(support=True):
        output = await _collect_csv(ops, ListEventsFilter(organization_id=event.organization_id))
    assert "note.deleted" in output.decode("utf-8")
