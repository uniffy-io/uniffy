"""``AuthOperations.register`` honours the public-registration gate.

The gate now resolves through ``deployment_settings`` (operator-edited
row) then env (``ALLOW_PUBLIC_REGISTRATION``) then a coded ``False``
default. These tests mock the deployment-settings layer so the
fallback chain is exercised without a real DB.
"""

import asyncio
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.domains.auth.errors import RegistrationError
from uniffy.domains.auth.operations import (
    AuthOperations,
    is_public_registration_enabled,
)


def _run(coro):
    return asyncio.run(coro)


def _empty_namespace_mock() -> AsyncMock:
    """Mock ``DeploymentSettingsOperations.get_namespace`` to return no rows."""
    instance = MagicMock()
    instance.get_namespace = AsyncMock(return_value={})
    return instance


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
    def test_env_fallback_when_no_deployment_row(self, raw: str, expected: bool) -> None:
        session = MagicMock()
        with (
            patch.dict(os.environ, {"ALLOW_PUBLIC_REGISTRATION": raw}, clear=False),
            patch(
                "uniffy.domains.system_config.operations.DeploymentSettingsOperations",
                return_value=_empty_namespace_mock(),
            ),
        ):
            assert _run(is_public_registration_enabled(session)) is expected

    def test_missing_env_defaults_to_false(self) -> None:
        env = {k: v for k, v in os.environ.items() if k != "ALLOW_PUBLIC_REGISTRATION"}
        session = MagicMock()
        with (
            patch.dict(os.environ, env, clear=True),
            patch(
                "uniffy.domains.system_config.operations.DeploymentSettingsOperations",
                return_value=_empty_namespace_mock(),
            ),
        ):
            assert _run(is_public_registration_enabled(session)) is False

    def test_deployment_row_wins_over_env(self) -> None:
        # Even with env set to false, a deployment row that says true wins.
        deployment_ops = MagicMock()
        row = MagicMock()
        row.is_secret = False
        row.value = True
        deployment_ops.get_namespace = AsyncMock(return_value={"public_registration": row})
        session = MagicMock()
        with (
            patch.dict(
                os.environ, {"ALLOW_PUBLIC_REGISTRATION": "false"}, clear=False
            ),
            patch(
                "uniffy.domains.system_config.operations.DeploymentSettingsOperations",
                return_value=deployment_ops,
            ),
        ):
            assert _run(is_public_registration_enabled(session)) is True


class TestRegisterGate:
    def test_rejects_when_disabled(self) -> None:
        session = AsyncMock()
        ops = AuthOperations(session)
        with (
            patch.dict(os.environ, {"ALLOW_PUBLIC_REGISTRATION": "false"}, clear=False),
            patch(
                "uniffy.domains.system_config.operations.DeploymentSettingsOperations",
                return_value=_empty_namespace_mock(),
            ),
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
            patch(
                "uniffy.domains.system_config.operations.DeploymentSettingsOperations",
                return_value=_empty_namespace_mock(),
            ),
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
