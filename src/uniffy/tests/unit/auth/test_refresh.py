from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from uniffy_proto.auth.v1.auth_pb2 import RefreshTokenRequest

from uniffy.domains.auth.errors import AuthenticationError
from uniffy.domains.auth.handlers import AuthHandlers


async def test_revoked_organization_membership_is_unauthenticated() -> None:
    operations = AsyncMock()
    operations.refresh_token.side_effect = AuthenticationError(
        "User is not a member of this organization"
    )

    @asynccontextmanager
    async def fake_open_session():
        yield AsyncMock()

    with (
        patch("uniffy.domains.auth.handlers.open_session", fake_open_session),
        patch("uniffy.domains.auth.handlers.AuthOperations", return_value=operations),
        pytest.raises(ConnectError) as exc_info,
    ):
        await AuthHandlers().refresh_token(
            RefreshTokenRequest(refresh_token="revoked-membership-token"),
            AsyncMock(),
        )

    assert exc_info.value.code is Code.UNAUTHENTICATED
