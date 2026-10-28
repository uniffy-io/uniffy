"""Public registration resolution across deployment, environment, and default tiers."""

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.config.registration import resolve_public_registration
from uniffy.core.config.source import SettingSource


def _empty_namespace_mock() -> AsyncMock:
    """Mock ``DeploymentSettingsOperations.get_namespace`` to return no rows."""
    instance = MagicMock()
    instance.get_namespace = AsyncMock(return_value={})
    return instance


class TestPublicRegistrationFlag:
    @pytest.mark.parametrize(
        ("raw", "expected", "expected_source"),
        [
            ("true", True, SettingSource.ENV),
            ("True", True, SettingSource.ENV),
            ("TRUE", True, SettingSource.ENV),
            ("false", False, SettingSource.ENV),
            ("0", False, SettingSource.ENV),
            ("", False, SettingSource.DEFAULT),
            ("anything-else", False, SettingSource.ENV),
        ],
    )
    async def test_env_fallback_when_no_deployment_row(
        self,
        raw: str,
        expected: bool,
        expected_source: SettingSource,
    ) -> None:
        session = MagicMock()
        with (
            patch.dict(os.environ, {"ALLOW_PUBLIC_REGISTRATION": raw}, clear=False),
            patch(
                "uniffy.core.config.registration.DeploymentSettingsOperations",
                return_value=_empty_namespace_mock(),
            ),
        ):
            state = await resolve_public_registration(session)
        assert state.enabled is expected
        assert state.source is expected_source

    async def test_missing_env_defaults_to_false(self) -> None:
        env = {k: v for k, v in os.environ.items() if k != "ALLOW_PUBLIC_REGISTRATION"}
        session = MagicMock()
        with (
            patch.dict(os.environ, env, clear=True),
            patch(
                "uniffy.core.config.registration.DeploymentSettingsOperations",
                return_value=_empty_namespace_mock(),
            ),
        ):
            state = await resolve_public_registration(session)
        assert state.enabled is False
        assert state.source is SettingSource.DEFAULT

    async def test_deployment_row_wins_over_env(self) -> None:
        # Even with env set to false, a deployment row that says true wins.
        deployment_ops = MagicMock()
        row = MagicMock()
        row.is_secret = False
        row.value = True
        deployment_ops.get_namespace = AsyncMock(return_value={"public_registration": row})
        session = MagicMock()
        with (
            patch.dict(os.environ, {"ALLOW_PUBLIC_REGISTRATION": "false"}, clear=False),
            patch(
                "uniffy.core.config.registration.DeploymentSettingsOperations",
                return_value=deployment_ops,
            ),
        ):
            state = await resolve_public_registration(session)
        assert state.enabled is True
        assert state.source is SettingSource.DEPLOYMENT
