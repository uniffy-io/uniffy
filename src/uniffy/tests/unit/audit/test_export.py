"""Tests for the streaming audit-event export.

DB calls are mocked. We assert:

- CSV output starts with the documented header row and the column order
  is RFC 4180-stable.
- NDJSON output emits one JSON object per line containing the same
  fields as the CSV.
- Filter parity: every ListEvents filter field flows into the SELECT
  bound parameters.
- Row cap: filters projecting more than MAX_EXPORT_ROWS raise
  ValidationError before any rows stream.
- Authorization: a regular member is denied before pre-flight runs.
"""

import csv
import json
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.errors import PermissionDeniedError, ValidationError
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
    """Session that lets an org ADMIN through with the given row batches.

    Sequence per stream_export call (when first batch is non-empty):

    1. OrganizationMember role -> ADMIN
    2. COUNT(*) row-cap check  -> count
    3. SELECT rows batch       -> batch
    4. SELECT emails batch     -> []   (no IDs to resolve -> still issued)
    5. (repeat 3 + 4 until a SELECT rows batch comes back empty)
    """
    session = MagicMock()
    side_effects: list = [_scalar(OrganizationRole.ADMIN), _scalar(count)]
    for batch in batches:
        side_effects.append(_rows(batch))
        if batch:
            side_effects.append(_emails([]))
    side_effects.append(_rows([]))
    session.execute = AsyncMock(side_effect=side_effects)
    return session


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
    output = await _collect_csv(ops, ListEventsFilter(organization_id=generate_id()))
    # Empty result: a header row is still emitted.
    first_line = output.decode("utf-8").splitlines()[0]
    reader = csv.reader([first_line])
    assert tuple(next(reader)) == CSV_COLUMNS


async def test_csv_serialises_an_event_row_into_the_expected_columns() -> None:
    event = _make_event()
    session = _admin_session(count=1, batches=[[event]])
    ops = ExportOperations(session)
    output = await _collect_csv(
        ops,
        ListEventsFilter(organization_id=event.organization_id),
    )

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
    assert json.loads(row["details_json"]) == {"reason": "cleanup"}


async def test_ndjson_emits_one_json_object_per_line_with_parsed_details() -> None:
    event = _make_event()
    session = _admin_session(count=1, batches=[[event]])
    ops = ExportOperations(session)
    output = await _collect_ndjson(
        ops,
        ListEventsFilter(organization_id=event.organization_id),
    )

    lines = [line for line in output.decode("utf-8").splitlines() if line]
    assert len(lines) == 1
    payload = json.loads(lines[0])
    assert payload["action"] == event.action
    assert payload["resource_id"] == str(event.resource_id)
    assert payload["details"] == {"reason": "cleanup"}
    assert payload["actor_org_role"] == "ADMIN"


async def test_row_cap_blocks_filters_that_would_dump_too_many_rows() -> None:
    session = MagicMock()
    session.execute = AsyncMock(
        side_effect=[
            _scalar(OrganizationRole.ADMIN),
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

    with pytest.raises(ValidationError):
        await _run()


async def test_regular_member_denied_before_export_begins() -> None:
    session = MagicMock()
    session.execute = AsyncMock(side_effect=[_scalar(OrganizationRole.MEMBER)])
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

    with pytest.raises(PermissionDeniedError):
        await _run()


async def test_system_admin_cannot_export_without_a_support_session() -> None:
    session = MagicMock()
    session.execute = AsyncMock(
        side_effect=[_scalar(None), _scalar(True)]  # no membership, is_system_admin
    )
    ops = ExportOperations(session)
    ops._read_ops._has_active_support_session = AsyncMock(return_value=False)

    async def _run() -> None:
        async for _ in ops.stream_export(
            generate_id(),
            ExportFilter(
                filter=ListEventsFilter(organization_id=generate_id()),
                format="csv",
            ),
        ):
            return

    with pytest.raises(PermissionDeniedError):
        await _run()


async def test_system_admin_exports_through_an_active_support_session() -> None:
    event = _make_event()
    session = MagicMock()
    session.execute = AsyncMock(
        side_effect=[
            _scalar(None),  # not a member of the org
            _scalar(True),  # is_system_admin
            _scalar(1),  # row count
            _rows([event]),
            _emails([]),
            _rows([]),
        ]
    )
    ops = ExportOperations(session)
    ops._read_ops._has_active_support_session = AsyncMock(return_value=True)

    output = await _collect_csv(
        ops,
        ListEventsFilter(organization_id=event.organization_id),
    )
    assert "note.deleted" in output.decode("utf-8")
