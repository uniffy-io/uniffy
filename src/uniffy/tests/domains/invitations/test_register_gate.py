"""``AuthOperations.register`` honours the ``ALLOW_PUBLIC_REGISTRATION`` env."""

import asyncio
import os
from unittest.mock import AsyncMock, patch

import pytest

from uniffy.domains.auth.errors import RegistrationError
from uniffy.domains.auth.operations import (
    AuthOperations,
    is_public_registration_enabled,
)


def _run(coro):
    return asyncio.run(coro)


class TestPublicRegistrationFlag:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("true", True),
            ("True", True),
            ("TRUE", True),
            ("false", False),
            ("0", False),
            ("", False),
            ("anything-else", False),
        ],
    )
    def test_parses_common_truthy_values(self, raw: str, expected: bool) -> None:
        with patch.dict(os.environ, {"ALLOW_PUBLIC_REGISTRATION": raw}, clear=False):
            assert is_public_registration_enabled() is expected

    def test_missing_env_defaults_to_false(self) -> None:
        env = {k: v for k, v in os.environ.items() if k != "ALLOW_PUBLIC_REGISTRATION"}
        with patch.dict(os.environ, env, clear=True):
            assert is_public_registration_enabled() is False


class TestRegisterGate:
    def test_rejects_when_disabled(self) -> None:
        session = AsyncMock()
        ops = AuthOperations(session)
        with (
            patch.dict(os.environ, {"ALLOW_PUBLIC_REGISTRATION": "false"}, clear=False),
            patch(
                "uniffy.domains.auth.operations.write_audit_event",
                new=AsyncMock(),
            ) as audit,
            pytest.raises(RegistrationError, match="invited"),
        ):
            _run(
                ops.register(
                    email="x@y.com",
                    username="x",
                    password="password1",
                )
            )
        audit.assert_awaited_once()
        # Session commit was awaited for the audit row only; user was never added.
        session.add.assert_not_called()

    def test_allows_when_enabled(self) -> None:
        # We only verify the gate falls through; downstream code raises on the
        # AsyncMock session inside the real flow, which is fine -- we just need
        # to know the gate did not short-circuit with RegistrationError.
        session = AsyncMock()
        ops = AuthOperations(session)
        with (
            patch.dict(os.environ, {"ALLOW_PUBLIC_REGISTRATION": "true"}, clear=False),
            patch.object(
                ops, "_get_user_by_email", new=AsyncMock(return_value=object())
            ),
            pytest.raises(RegistrationError, match="already"),
        ):
            _run(
                ops.register(
                    email="dup@y.com",
                    username="dup",
                    password="password1",
                )
            )
