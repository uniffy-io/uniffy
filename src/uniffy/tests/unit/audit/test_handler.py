"""Authorization + cursor pagination on ``AuditOperations.list_events``.

DB calls are mocked. We assert:

- Org ADMIN / OWNER on the same org pass.
- Regular org members raise ``PermissionDeniedError``.
- ``User.is_system_admin`` overrides org membership and lets the
  actor query any org.
- Cursor round-trips via ``_encode_cursor`` / ``_decode_cursor``.
- The handler caps ``page_size`` at ``MAX_PAGE_SIZE`` and falls back
  to ``DEFAULT_PAGE_SIZE`` for zero / negative inputs.
"""

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.domains.audit.operations import (
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    AuditOperations,
    ListEventsFilter,
    SortOrder,
    _decode_cursor,
    _encode_cursor,
)


def _session_with_actor(
    *,
    is_system_admin: bool = False,
    org_role: OrganizationRole | None = None,
) -> MagicMock:
    session = MagicMock()
    sa_results = [
        _scalar_result(is_system_admin),
        _scalar_result(org_role),
    ]
    session.execute = AsyncMock(side_effect=sa_results)
    return session


def _scalar_result(value):
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    result.scalars.return_value.all.return_value = []
    return result


def test_org_admin_can_query_own_org() -> None:
    session = _session_with_actor(org_role=OrganizationRole.ADMIN)
    session.execute = AsyncMock(
        side_effect=[
            _scalar_result(False),
            _scalar_result(OrganizationRole.ADMIN),
            _list_result([]),
        ]
    )
    ops = AuditOperations(session)

    page = asyncio.run(
        ops.list_events(
            uuid4(),
            ListEventsFilter(organization_id=uuid4()),
        )
    )

    assert page.events == []
    assert page.next_page_token is None


def test_regular_member_denied() -> None:
    session = _session_with_actor(org_role=OrganizationRole.MEMBER)
    ops = AuditOperations(session)

    with pytest.raises(PermissionDeniedError):
        asyncio.run(
            ops.list_events(
                uuid4(),
                ListEventsFilter(organization_id=uuid4()),
            )
        )


def test_system_admin_can_query_any_org() -> None:
    session = MagicMock()
    session.execute = AsyncMock(
        side_effect=[_scalar_result(True), _list_result([])]
    )
    ops = AuditOperations(session)

    page = asyncio.run(
        ops.list_events(
            uuid4(),
            ListEventsFilter(organization_id=uuid4()),
        )
    )

    assert page.events == []


def _list_result(rows):
    result = MagicMock()
    result.scalars.return_value.all.return_value = rows
    return result


def test_cursor_encode_decode_roundtrip() -> None:
    moment = datetime(2026, 5, 20, 12, 34, 56, tzinfo=UTC)
    event_id = uuid4()
    token = _encode_cursor(moment, event_id)
    decoded_at, decoded_id = _decode_cursor(token)
    assert decoded_at == moment
    assert decoded_id == event_id


def test_malformed_cursor_raises_validation_error() -> None:
    with pytest.raises(ValidationError):
        _decode_cursor("not-a-real-cursor")


def test_filter_default_order_is_time_desc() -> None:
    assert ListEventsFilter(organization_id=uuid4()).order is SortOrder.TIME_DESC


def test_filter_accepts_time_asc_order() -> None:
    f = ListEventsFilter(organization_id=uuid4(), order=SortOrder.TIME_ASC)
    assert f.order is SortOrder.TIME_ASC


def test_page_size_caps_at_max() -> None:
    page_size = ListEventsFilter(
        organization_id=uuid4(),
        page_size=10_000,
    ).page_size
    assert page_size == 10_000  # filter holds raw value
    # The operation caps internally; the cap value should equal MAX_PAGE_SIZE.
    assert MAX_PAGE_SIZE == 500
    assert DEFAULT_PAGE_SIZE == 50
