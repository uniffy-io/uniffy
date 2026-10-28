"""A refusal for a missing organization membership carries a typed reason clients can act on."""

from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError

from uniffy.core.errors import MembershipRequiredError, PermissionDeniedError
from uniffy.transport.rpc import (
    ERROR_INFO_DOMAIN,
    MEMBERSHIP_REQUIRED_REASON,
    LoggingInterceptor,
    error_info_detail,
)

CONTEXT = SimpleNamespace(
    method=SimpleNamespace(name="organizations.v1.OrganizationsService/GetOrganization")
)
_ERROR_INFO = "google.rpc.ErrorInfo"
# google.rpc.ErrorInfo wire bytes: field 1 reason, field 2 domain.
_MEMBERSHIP_REQUIRED = (
    _ERROR_INFO,
    b"\x0a\x13" + MEMBERSHIP_REQUIRED_REASON.encode() + b"\x12\x06" + ERROR_INFO_DOMAIN.encode(),
)
_MESSAGE = "Permission denied: Requires organization membership"


def _missing_membership() -> MembershipRequiredError:
    return MembershipRequiredError("Requires organization membership")


def _details(error: ConnectError) -> list[tuple[str, bytes]]:
    return [(detail.type_name, detail.message_bytes) for detail in error.details]


async def _unary(handler: Any) -> ConnectError:
    with pytest.raises(ConnectError) as refused:
        await LoggingInterceptor().intercept_unary(handler, object(), CONTEXT)
    return refused.value


async def test_an_unmapped_membership_error_answers_with_the_reason() -> None:
    async def refuse(request: Any, context: Any) -> None:
        raise _missing_membership()

    error = await _unary(refuse)

    assert error.code is Code.PERMISSION_DENIED
    assert error.message == _MESSAGE
    assert _details(error) == [_MEMBERSHIP_REQUIRED]


async def test_a_handler_that_maps_the_error_itself_still_answers_with_the_reason() -> None:
    async def refuse(request: Any, context: Any) -> None:
        try:
            raise _missing_membership()
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))

    error = await _unary(refuse)

    assert error.code is Code.PERMISSION_DENIED
    assert error.message == _MESSAGE
    assert _details(error) == [_MEMBERSHIP_REQUIRED]


async def test_an_explicitly_chained_mapping_answers_with_the_reason() -> None:
    async def refuse(request: Any, context: Any) -> None:
        try:
            raise _missing_membership()
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied") from e

    error = await _unary(refuse)

    assert error.message == "Access denied"
    assert _details(error) == [_MEMBERSHIP_REQUIRED]


async def test_a_role_refusal_carries_no_reason() -> None:
    async def refuse(request: Any, context: Any) -> None:
        try:
            raise PermissionDeniedError("Requires organization admin privileges")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))

    error = await _unary(refuse)

    assert error.code is Code.PERMISSION_DENIED
    assert error.details == ()


async def test_a_handler_that_hides_the_refusal_behind_not_found_keeps_its_answer() -> None:
    async def refuse(request: Any, context: Any) -> None:
        try:
            raise _missing_membership()
        except PermissionDeniedError:
            raise ConnectError(Code.NOT_FOUND, "Upload not found")

    error = await _unary(refuse)

    assert error.code is Code.NOT_FOUND
    assert error.details == ()


async def test_a_suppressed_cause_keeps_the_handler_answer() -> None:
    async def refuse(request: Any, context: Any) -> None:
        try:
            raise _missing_membership()
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied") from None

    error = await _unary(refuse)

    assert error.details == ()


async def test_a_server_stream_answers_with_the_reason() -> None:
    async def refuse(request: Any, context: Any) -> AsyncIterator[str]:
        yield "first"
        raise _missing_membership()

    received = []
    with pytest.raises(ConnectError) as refused:
        async for item in LoggingInterceptor().intercept_server_stream(refuse, object(), CONTEXT):
            received.append(item)

    assert received == ["first"]
    assert refused.value.code is Code.PERMISSION_DENIED
    assert _details(refused.value) == [_MEMBERSHIP_REQUIRED]


async def test_a_client_stream_mapped_by_its_handler_answers_with_the_reason() -> None:
    async def refuse(request: Any, context: Any) -> None:
        try:
            raise _missing_membership()
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))

    with pytest.raises(ConnectError) as refused:
        await LoggingInterceptor().intercept_client_stream(refuse, object(), CONTEXT)

    assert _details(refused.value) == [_MEMBERSHIP_REQUIRED]


def test_a_long_reason_encodes_a_multi_byte_length() -> None:
    reason = "r" * 200

    value = error_info_detail(reason).message_bytes

    assert value[:3] == b"\x0a\xc8\x01"
    assert value[3:203] == reason.encode()
    assert value[203:] == b"\x12\x06" + ERROR_INFO_DOMAIN.encode()
