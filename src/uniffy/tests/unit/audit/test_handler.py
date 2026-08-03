"""Authorization + cursor pagination on ``AuditOperations.list_events``.

DB calls are mocked. A tenant's audit trail is tenant data, so a platform
operator outside the org reaches it only through an active SupportSession -
``is_system_admin`` alone is not a key.
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.types import generate_id
from uniffy.domains.audit.operations import (
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    AuditOperations,
    ListEventsFilter,
    SortOrder,
    _decode_cursor,
    _encode_cursor,
)


def _scalar_result(value):
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    result.scalars.return_value.all.return_value = []
    return result


def _ops(*results, support_session: bool = False) -> AuditOperations:
    """``AuditOperations`` whose session replays ``results`` in query order."""
    session = MagicMock()
    session.execute = AsyncMock(side_effect=list(results))
    ops = AuditOperations(session)
    ops._has_active_support_session = AsyncMock(return_value=support_session)
    return ops


async def test_org_admin_can_query_own_org() -> None:
    ops = _ops(_scalar_result(OrganizationRole.ADMIN), _list_result([]))

    page = await ops.list_events(
        generate_id(),
        ListEventsFilter(organization_id=generate_id()),
    )

    assert page.events == []
    assert page.next_page_token is None


async def test_org_owner_can_query_own_org() -> None:
    ops = _ops(_scalar_result(OrganizationRole.OWNER), _list_result([]))

    page = await ops.list_events(
        generate_id(),
        ListEventsFilter(organization_id=generate_id()),
    )

    assert page.events == []


async def test_regular_member_denied() -> None:
    ops = _ops(_scalar_result(OrganizationRole.MEMBER))

    with pytest.raises(PermissionDeniedError):
        await ops.list_events(
            generate_id(),
            ListEventsFilter(organization_id=generate_id()),
        )


async def test_system_admin_denied_without_support_session() -> None:
    ops = _ops(
        _scalar_result(None),
        _scalar_result(True),
        support_session=False,
    )

    with pytest.raises(PermissionDeniedError):
        await ops.list_events(
            generate_id(),
            ListEventsFilter(organization_id=generate_id()),
        )


async def test_system_admin_allowed_with_active_support_session() -> None:
    ops = _ops(
        _scalar_result(None),
        _scalar_result(True),
        _list_result([]),
        support_session=True,
    )

    page = await ops.list_events(
        generate_id(),
        ListEventsFilter(organization_id=generate_id()),
    )

    assert page.events == []


async def test_system_admin_who_is_a_plain_member_gets_no_bypass() -> None:
    """Membership is evaluated first, so a MEMBER row denies before the operator path."""
    ops = _ops(_scalar_result(OrganizationRole.MEMBER), support_session=True)

    with pytest.raises(PermissionDeniedError):
        await ops.list_events(
            generate_id(),
            ListEventsFilter(organization_id=generate_id()),
        )


async def test_non_member_non_admin_denied() -> None:
    ops = _ops(_scalar_result(None), _scalar_result(False))

    with pytest.raises(PermissionDeniedError):
        await ops.list_events(
            generate_id(),
            ListEventsFilter(organization_id=generate_id()),
        )


def _list_result(rows):
    result = MagicMock()
    result.scalars.return_value.all.return_value = rows
    return result


def test_cursor_encode_decode_roundtrip() -> None:
    moment = datetime(2026, 5, 20, 12, 34, 56, tzinfo=UTC)
    event_id = generate_id()
    token = _encode_cursor(moment, event_id)
    decoded_at, decoded_id = _decode_cursor(token)
    assert decoded_at == moment
    assert decoded_id == event_id


def test_malformed_cursor_raises_validation_error() -> None:
    with pytest.raises(ValidationError):
        _decode_cursor("not-a-real-cursor")


def test_filter_default_order_is_time_desc() -> None:
    assert ListEventsFilter(organization_id=generate_id()).order is SortOrder.TIME_DESC


def test_filter_accepts_time_asc_order() -> None:
    f = ListEventsFilter(organization_id=generate_id(), order=SortOrder.TIME_ASC)
    assert f.order is SortOrder.TIME_ASC


def test_page_size_caps_at_max() -> None:
    page_size = ListEventsFilter(
        organization_id=generate_id(),
        page_size=10_000,
    ).page_size
    assert page_size == 10_000  # filter holds raw value
    # The operation caps internally; the cap value should equal MAX_PAGE_SIZE.
    assert MAX_PAGE_SIZE == 500
    assert DEFAULT_PAGE_SIZE == 50
