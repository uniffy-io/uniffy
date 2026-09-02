"""SecurityOperations CRUD with sessions mocked."""

from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.audit.actions import Action
from uniffy.core.types import generate_id
from uniffy.domains.organizations.security.operations import (
    SECURITY_NAMESPACE,
    SecurityOperations,
)


@dataclass
class _Row:
    key: str
    value: Any = None


def _session(rows: list[_Row] | None = None):
    session = MagicMock()
    if rows is None:
        rows = []
    scalars = MagicMock()
    scalars.all = lambda: rows
    result = MagicMock()
    result.scalars = lambda: scalars
    session.execute = AsyncMock(return_value=result)
    session.add = MagicMock()
    session.commit = AsyncMock()
    return session


def _patch_settings_ops():
    """``OrgSettingsOperations`` is constructed inside ``SecurityOperations``;
    return a controllable mock instead so we can assert ``set`` calls."""
    inner = MagicMock()
    inner.get_namespace = AsyncMock(return_value={})
    inner.set = AsyncMock()
    return patch(
        "uniffy.domains.organizations.security.operations.OrgSettingsOperations",
        return_value=inner,
    ), inner


class TestGet:
    async def test_missing_row_returns_default_enabled(self) -> None:
        session = _session()
        patcher, settings = _patch_settings_ops()
        settings.get_namespace = AsyncMock(return_value={})
        with patcher:
            out = await SecurityOperations(session).get(generate_id())
        assert out.password_reset_enabled is True

    async def test_explicit_disabled_row_wins_over_default(self) -> None:
        from uniffy.core.models.settings.org_setting import OrgSetting

        row = OrgSetting(
            organization_id=generate_id(),
            namespace=SECURITY_NAMESPACE,
            key="password_reset_enabled",
            value=False,
            is_secret=False,
        )
        session = _session()
        patcher, settings = _patch_settings_ops()
        settings.get_namespace = AsyncMock(return_value={"password_reset_enabled": row})
        with patcher:
            out = await SecurityOperations(session).get(generate_id())
        assert out.password_reset_enabled is False


class TestSet:
    async def test_changing_value_writes_audit_and_setting(self) -> None:
        session = _session()
        org_id = generate_id()
        actor = generate_id()
        patcher, settings = _patch_settings_ops()
        settings.get_namespace = AsyncMock(return_value={})  # default is True
        settings.set = AsyncMock()
        with (
            patcher,
            patch(
                "uniffy.domains.organizations.security.operations.write_audit_event",
                new=AsyncMock(),
            ) as audit,
        ):
            await SecurityOperations(session).set_password_reset_enabled(
                organization_id=org_id,
                enabled=False,
                actor_user_id=actor,
            )
        settings.set.assert_awaited_once()
        audit.assert_awaited_once()
        kwargs = audit.call_args.kwargs
        assert kwargs["action"] == Action.ORGANIZATION_SECURITY_SETTINGS_CHANGED
        assert kwargs["details"]["previous"] is True
        assert kwargs["details"]["new"] is False

    async def test_unchanged_value_is_a_noop(self) -> None:
        from uniffy.core.models.settings.org_setting import OrgSetting

        existing = OrgSetting(
            organization_id=generate_id(),
            namespace=SECURITY_NAMESPACE,
            key="password_reset_enabled",
            value=True,
            is_secret=False,
        )
        session = _session()
        patcher, settings = _patch_settings_ops()
        settings.get_namespace = AsyncMock(return_value={"password_reset_enabled": existing})
        settings.set = AsyncMock()
        with (
            patcher,
            patch(
                "uniffy.domains.organizations.security.operations.write_audit_event",
                new=AsyncMock(),
            ) as audit,
        ):
            await SecurityOperations(session).set_password_reset_enabled(
                organization_id=generate_id(),
                enabled=True,
                actor_user_id=generate_id(),
            )
        settings.set.assert_not_awaited()
        audit.assert_not_awaited()
