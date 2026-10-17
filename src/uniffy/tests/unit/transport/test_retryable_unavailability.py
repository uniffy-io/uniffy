"""Retryable unavailability reaches clients as UNAVAILABLE with its client-safe message."""

from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError

from uniffy.core.realtime.live import LiveStateUnavailable
from uniffy.transport.rpc import LoggingInterceptor

CONTEXT = SimpleNamespace(method=SimpleNamespace(name="notes.v1.NotesService/UpdateNote"))


def unverifiable() -> LiveStateUnavailable:
    return LiveStateUnavailable("Pending realtime edits cannot be verified; retry")


async def test_unary_call_answers_unavailable() -> None:
    error = unverifiable()

    async def refuse(request: Any, context: Any) -> None:
        raise error

    with pytest.raises(ConnectError) as refused:
        await LoggingInterceptor().intercept_unary(refuse, object(), CONTEXT)

    assert refused.value.code is Code.UNAVAILABLE
    assert refused.value.message == str(error)


async def test_server_stream_answers_unavailable() -> None:
    error = unverifiable()

    async def refuse(request: Any, context: Any) -> AsyncIterator[str]:
        yield "first"
        raise error

    received = []
    with pytest.raises(ConnectError) as refused:
        async for item in LoggingInterceptor().intercept_server_stream(refuse, object(), CONTEXT):
            received.append(item)

    assert received == ["first"]
    assert refused.value.code is Code.UNAVAILABLE
    assert refused.value.message == str(error)
