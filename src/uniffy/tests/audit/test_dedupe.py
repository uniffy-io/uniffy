"""Valkey-debounced writes for high-volume actions like ``auth.token_refreshed``.

The writer uses ``SET NX`` keyed
``audit:debounce:{action}:{dedupe_key}``. Lock acquisition allows the
write; lock contention suppresses it. Valkey unavailability is
fail-open.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.models.login.organization_member import OrganizationRole


def _session_with_role() -> MagicMock:
    session = MagicMock()
    role_result = MagicMock()
    role_result.scalar_one_or_none.return_value = OrganizationRole.MEMBER
    session.execute = AsyncMock(return_value=role_result)
    session.add = MagicMock()
    return session


def test_dedupe_lock_acquired_inserts_one_row() -> None:
    session = _session_with_role()
    valkey = MagicMock()
    valkey.set = AsyncMock(return_value=True)

    with patch(
        "uniffy.core.audit.writer._get_ops_client", return_value=valkey
    ):
        asyncio.run(
            write_audit_event(
                session,
                organization_id=uuid4(),
                actor_user_id=uuid4(),
                action=Action.AUTH_TOKEN_REFRESHED,
                dedupe_key="user-1",
            )
        )

    session.add.assert_called_once()
    args, kwargs = valkey.set.call_args
    assert args[0].startswith("audit:debounce:auth.token_refreshed:")
    assert kwargs == {"nx": True, "ex": 3600}


def test_dedupe_lock_held_skips_write() -> None:
    session = _session_with_role()
    valkey = MagicMock()
    valkey.set = AsyncMock(return_value=False)

    with patch(
        "uniffy.core.audit.writer._get_ops_client", return_value=valkey
    ):
        asyncio.run(
            write_audit_event(
                session,
                organization_id=uuid4(),
                actor_user_id=uuid4(),
                action=Action.AUTH_TOKEN_REFRESHED,
                dedupe_key="user-1",
            )
        )

    session.add.assert_not_called()


def test_dedupe_fails_open_when_valkey_unreachable() -> None:
    session = _session_with_role()

    with patch(
        "uniffy.core.audit.writer._get_ops_client", return_value=None
    ):
        asyncio.run(
            write_audit_event(
                session,
                organization_id=uuid4(),
                actor_user_id=uuid4(),
                action=Action.AUTH_TOKEN_REFRESHED,
                dedupe_key="user-1",
            )
        )

    session.add.assert_called_once()


def test_dedupe_fails_open_when_valkey_call_errors() -> None:
    session = _session_with_role()
    valkey = MagicMock()
    valkey.set = AsyncMock(side_effect=RuntimeError("network"))

    with patch(
        "uniffy.core.audit.writer._get_ops_client", return_value=valkey
    ):
        asyncio.run(
            write_audit_event(
                session,
                organization_id=uuid4(),
                actor_user_id=uuid4(),
                action=Action.AUTH_TOKEN_REFRESHED,
                dedupe_key="user-1",
            )
        )

    session.add.assert_called_once()
