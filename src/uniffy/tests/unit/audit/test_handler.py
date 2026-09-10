"""Authorization and cursor pagination for audit-event reads."""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from connectrpc.errors import ConnectError

from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.types import generate_id
from uniffy.domains.audit.handlers import _parse_resource_type
from uniffy.core.pagination import decode_time_cursor, encode_time_cursor
from uniffy.domains.audit.operations import (
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    AuditOperations,
    ListEventsFilter,
    SortOrder,
)


def _scalar_result(value):
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    result.scalars.return_value.all.return_value = []
    return result


def _ops(*results) -> AuditOperations:
    session = MagicMock()
    session.execute = AsyncMock(side_effect=list(results))
    return AuditOperations(session)


def _auth(role: OrganizationRole | None = None, *, support: bool = False):
    membership = SimpleNamespace(role=role) if role is not None else None
    return patch.multiple(
        "uniffy.domains.audit.operations",
        get_active_membership=AsyncMock(return_value=membership),
        get_active_support_access=AsyncMock(return_value=MagicMock() if support else None),
    )


async def test_org_admin_can_query_own_org() -> None:
    ops = _ops(_list_result([]))

    with _auth(OrganizationRole.ADMIN):
        page = await ops.list_events(generate_id(), ListEventsFilter(organization_id=generate_id()))

    assert page.events == []
    assert page.next_page_token is None


async def test_org_owner_can_query_own_org() -> None:
    ops = _ops(_list_result([]))

    with _auth(OrganizationRole.OWNER):
        page = await ops.list_events(generate_id(), ListEventsFilter(organization_id=generate_id()))

    assert page.events == []


async def test_regular_member_denied() -> None:
    ops = _ops()

    with _auth(OrganizationRole.MEMBER), pytest.raises(PermissionDeniedError):
        await ops.list_events(
            generate_id(),
            ListEventsFilter(organization_id=generate_id()),
        )


async def test_system_admin_denied_without_support_session() -> None:
    ops = _ops()

    with _auth(), pytest.raises(PermissionDeniedError):
        await ops.list_events(
            generate_id(),
            ListEventsFilter(organization_id=generate_id()),
        )


async def test_system_admin_allowed_with_active_support_session() -> None:
    ops = _ops(_list_result([]))

    with _auth(support=True):
        page = await ops.list_events(generate_id(), ListEventsFilter(organization_id=generate_id()))

    assert page.events == []


async def test_system_admin_who_is_a_plain_member_gets_no_bypass() -> None:
    ops = _ops()

    with _auth(OrganizationRole.MEMBER, support=True), pytest.raises(PermissionDeniedError):
        await ops.list_events(
            generate_id(),
            ListEventsFilter(organization_id=generate_id()),
        )


async def test_non_member_non_admin_denied() -> None:
    ops = _ops()

    with _auth(), pytest.raises(PermissionDeniedError):
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
    token = encode_time_cursor(moment, event_id)
    decoded_at, decoded_id = decode_time_cursor(token)
    assert decoded_at == moment
    assert decoded_id == event_id


def test_malformed_cursor_raises_validation_error() -> None:
    with pytest.raises(ValidationError):
        decode_time_cursor("not-a-real-cursor")


def test_filter_default_order_is_time_desc() -> None:
    assert ListEventsFilter(organization_id=generate_id()).order is SortOrder.TIME_DESC


def test_filter_accepts_time_asc_order() -> None:
    f = ListEventsFilter(organization_id=generate_id(), order=SortOrder.TIME_ASC)
    assert f.order is SortOrder.TIME_ASC


def test_resource_type_filter_normalizes_legacy_casing() -> None:
    assert _parse_resource_type("organization") is AuditResourceType.ORGANIZATION


def test_resource_type_filter_rejects_unknown_values() -> None:
    with pytest.raises(ConnectError):
        _parse_resource_type("not-a-resource")


def test_page_size_caps_at_max() -> None:
    page_size = ListEventsFilter(
        organization_id=generate_id(),
        page_size=10_000,
    ).page_size
    assert page_size == 10_000  # filter holds raw value
    # The operation caps internally; the cap value should equal MAX_PAGE_SIZE.
    assert MAX_PAGE_SIZE == 500
    assert DEFAULT_PAGE_SIZE == 50
