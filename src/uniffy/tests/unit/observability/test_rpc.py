from typing import Any

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError

from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.transport.rpc import LoggingInterceptor, code_for_domain_error


def test_domain_errors_keep_their_connect_codes() -> None:
    assert code_for_domain_error(NotFoundError("note", "missing")) is Code.NOT_FOUND
    assert code_for_domain_error(ValidationError("title", "required")) is Code.INVALID_ARGUMENT


@pytest.mark.asyncio
async def test_unhandled_unary_error_is_sanitized() -> None:
    class Method:
        name = "notes.v1.NotesService/GetNote"

    class Context:
        method = Method()

    async def raise_secret(request: Any, context: Any) -> None:
        raise RuntimeError("database password leaked")

    with pytest.raises(ConnectError) as exc_info:
        await LoggingInterceptor().intercept_unary(raise_secret, object(), Context())

    assert exc_info.value.code is Code.INTERNAL
    assert exc_info.value.message == "Internal server error"
    assert "password" not in exc_info.value.message
