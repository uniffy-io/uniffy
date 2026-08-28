"""Authentication registration honors the deployment registration policy."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.domains.auth.errors import RegistrationError
from uniffy.domains.auth.operations import AuthOperations


class TestRegisterGate:
    async def test_rejects_when_disabled(self) -> None:
        session = AsyncMock()
        session.add = MagicMock()
        ops = AuthOperations(session)
        with (
            patch(
                "uniffy.domains.auth.operations.public_registration_enabled",
                new=AsyncMock(return_value=False),
            ),
            patch(
                "uniffy.domains.auth.operations.write_audit_event",
                new=AsyncMock(),
            ) as audit,
            pytest.raises(RegistrationError, match="invited"),
        ):
            await ops.register(
                email="x@y.com",
                username="x",
                password="password1",
            )
        audit.assert_awaited_once()
        session.add.assert_not_called()

    async def test_allows_when_enabled(self) -> None:
        session = AsyncMock()
        session.add = MagicMock()
        ops = AuthOperations(session)
        with (
            patch(
                "uniffy.domains.auth.operations.public_registration_enabled",
                new=AsyncMock(return_value=True),
            ),
            patch.object(ops, "_get_user_by_email", new=AsyncMock(return_value=object())),
            patch.object(ops, "_get_user_by_username", new=AsyncMock(return_value=None)),
            pytest.raises(RegistrationError, match="Could not create account"),
        ):
            await ops.register(
                email="dup@y.com",
                username="dup",
                password="password1",
            )
