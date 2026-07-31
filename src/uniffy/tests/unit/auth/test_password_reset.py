"""PasswordResetOperations request / verify / consume flows.

Mocks the session, queue, and the SecurityOperations dependency. Validates
the audit + enqueue behavior for the three documented outcomes
(no_user, disabled_for_org, sent).
"""

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from uniffy.core.audit.actions import Action
from uniffy.domains.auth.password_reset import (
    PasswordResetOperations,
    PasswordResetTokenExpiredError,
    PasswordResetTokenNotFoundError,
    PasswordResetTokenUsedError,
    _hash_token,
)
from uniffy.domains.security.operations import SecuritySettings


def _run(coro):
    return asyncio.run(coro)


@dataclass
class _User:
    id: Any
    email: str
    username: str = "alice"
    full_name: str | None = "Alice"
    is_active: bool = True
    hashed_password: str | None = "old-hash"
    token_version: int = 0
    avatar_key: str | None = None


@dataclass
class _Org:
    id: Any
    name: str = "Acme"
    slug: str = "acme"


@dataclass
class _Membership:
    organization_id: Any


@dataclass
class _Token:
    id: Any
    user_id: Any
    token_hash: str
    expires_at: datetime
    used_at: datetime | None = None
    requested_ip: str | None = None


def _result(*, scalar=None, first=None):
    r = MagicMock()
    r.scalar_one_or_none = lambda: scalar
    r.first = lambda: first
    return r


def _session(results: list[Any]):
    session = MagicMock()
    iterator = iter(results)

    async def execute(_stmt, *args, **kwargs):
        try:
            return next(iterator)
        except StopIteration:
            return _result()

    session.execute = execute
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    return session


def _patch_queue():
    queue = MagicMock()
    queue.enqueue_job = AsyncMock()
    return patch(
        "uniffy.domains.auth.password_reset.get_queue", return_value=queue,
    ), queue


def _patch_security(*, password_reset_enabled: bool):
    inner = MagicMock()
    inner.get = AsyncMock(
        return_value=SecuritySettings(
            password_reset_enabled=password_reset_enabled,
            mfa_required_for_members=False,
            mfa_required_for_admins=False,
        ),
    )
    return patch(
        "uniffy.domains.auth.password_reset.SecurityOperations",
        return_value=inner,
    )


class TestRequest:
    def test_unknown_email_writes_audit_and_skips_enqueue(self) -> None:
        # request -> user lookup returns None -> audit + return
        session = _session([_result(scalar=None)])
        queue_patch, queue = _patch_queue()
        with queue_patch, patch(
            "uniffy.domains.auth.password_reset.write_audit_event", new=AsyncMock()
        ) as audit:
            _run(PasswordResetOperations(session).request("ghost@example.com"))
        queue.enqueue_job.assert_not_awaited()
        audit.assert_awaited_once()
        details = audit.call_args.kwargs["details"]
        assert details["outcome"] == "no_user"

    def test_disabled_for_org_writes_blocked_audit(self) -> None:
        user_id = uuid4()
        org_id = uuid4()
        user = _User(id=user_id, email="x@y.com")
        org = _Org(id=org_id)
        membership = _Membership(organization_id=org_id)
        # Order: lookup user, lookup primary-org row
        session = _session([
            _result(scalar=user),
            _result(first=(membership, org)),
        ])
        queue_patch, queue = _patch_queue()
        with queue_patch, _patch_security(password_reset_enabled=False), patch(
            "uniffy.domains.auth.password_reset.write_audit_event", new=AsyncMock()
        ) as audit:
            _run(PasswordResetOperations(session).request("x@y.com"))
        queue.enqueue_job.assert_not_awaited()
        actions = [c.kwargs["action"] for c in audit.call_args_list]
        assert Action.AUTH_PASSWORD_RESET_BLOCKED in actions

    def test_enabled_org_enqueues_email_and_writes_request_audit(self) -> None:
        user_id = uuid4()
        org_id = uuid4()
        user = _User(id=user_id, email="x@y.com")
        org = _Org(id=org_id)
        membership = _Membership(organization_id=org_id)
        # Order: lookup user, primary-org lookup, primary-org lookup again
        # before audit (called from _resolve_primary_org inside the second branch).
        session = _session([
            _result(scalar=user),
            _result(first=(membership, org)),
        ])
        queue_patch, queue = _patch_queue()
        with queue_patch, _patch_security(password_reset_enabled=True), patch(
            "uniffy.domains.auth.password_reset.write_audit_event", new=AsyncMock()
        ) as audit:
            _run(PasswordResetOperations(session).request("x@y.com"))
        queue.enqueue_job.assert_awaited_once()
        call = queue.enqueue_job.await_args
        assert call.args[2] == "auth/password_reset"
        actions = [c.kwargs["action"] for c in audit.call_args_list]
        assert Action.AUTH_PASSWORD_RESET_REQUESTED in actions

    def test_user_with_no_org_falls_back_to_env(self) -> None:
        user = _User(id=uuid4(), email="orgless@x.com")
        # Order: lookup user, primary-org lookup returns None
        session = _session([
            _result(scalar=user),
            _result(first=None),
        ])
        queue_patch, queue = _patch_queue()
        with queue_patch, patch(
            "uniffy.domains.auth.password_reset.write_audit_event", new=AsyncMock()
        ) as audit:
            _run(PasswordResetOperations(session).request("orgless@x.com"))
        # Skips the security check (no org), enqueues with organization_id=None
        queue.enqueue_job.assert_awaited_once()
        call = queue.enqueue_job.await_args
        assert call.kwargs["organization_id"] is None
        # Audit row carries config_source="env"
        request_audits = [
            c for c in audit.call_args_list
            if c.kwargs["action"] == Action.AUTH_PASSWORD_RESET_REQUESTED
        ]
        assert request_audits, "expected at least one request audit row"
        assert request_audits[-1].kwargs["details"]["config_source"] == "env"


class TestVerifyAndConsume:
    def _token_row(self, **overrides: Any) -> tuple[_Token, _User]:
        user = _User(id=uuid4(), email="x@y.com")
        token = _Token(
            id=uuid4(),
            user_id=user.id,
            token_hash=_hash_token("raw-token"),
            expires_at=datetime.now(UTC) + timedelta(minutes=10),
        )
        for k, v in overrides.items():
            setattr(token, k, v)
        return token, user

    def test_verify_returns_preview(self) -> None:
        token, user = self._token_row()
        session = _session([_result(first=(token, user))])
        preview = _run(PasswordResetOperations(session).verify("raw-token"))
        assert preview.email == user.email

    def test_verify_rejects_expired(self) -> None:
        token, user = self._token_row(
            expires_at=datetime.now(UTC) - timedelta(seconds=1),
        )
        session = _session([_result(first=(token, user))])
        with pytest.raises(PasswordResetTokenExpiredError):
            _run(PasswordResetOperations(session).verify("raw-token"))

    def test_verify_rejects_used(self) -> None:
        token, user = self._token_row(used_at=datetime.now(UTC))
        session = _session([_result(first=(token, user))])
        with pytest.raises(PasswordResetTokenUsedError):
            _run(PasswordResetOperations(session).verify("raw-token"))

    def test_verify_rejects_unknown_token(self) -> None:
        session = _session([_result(first=None)])
        with pytest.raises(PasswordResetTokenNotFoundError):
            _run(PasswordResetOperations(session).verify("raw-token"))

    def test_consume_bumps_token_version_and_marks_used(self) -> None:
        token, user = self._token_row()
        # Order: load token+user; resolve primary-org (returns None for simplicity)
        session = _session([
            _result(first=(token, user)),
            _result(first=None),
        ])
        with patch(
            "uniffy.domains.auth.password_reset.write_audit_event", new=AsyncMock()
        ) as audit, patch(
            "uniffy.domains.auth.password_reset.hash_password",
            return_value="new-hash",
        ):
            updated = _run(
                PasswordResetOperations(session).consume("raw-token", "newpassword1"),
            )
        assert updated.hashed_password == "new-hash"
        assert updated.token_version == 1
        assert token.used_at is not None
        actions = [c.kwargs["action"] for c in audit.call_args_list]
        assert Action.AUTH_PASSWORD_RESET_COMPLETED in actions

    def test_consume_rejects_short_password(self) -> None:
        from uniffy.core.errors import ValidationError

        session = _session([])
        with pytest.raises(ValidationError, match="at least 8"):
            _run(PasswordResetOperations(session).consume("raw-token", "short"))
