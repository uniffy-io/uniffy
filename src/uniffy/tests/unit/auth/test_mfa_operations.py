"""Regression coverage for the MFA operation fixes.

These tests target the three behaviour invariants that the verify /
enrollment paths now enforce:

* ``BeginEnrollment`` refuses when MFA is already enabled, so a
  session takeover cannot silently neutralise the second factor by
  overwriting the secret + flipping ``enabled=False``.
* ``VerifyMfa`` checks ``user.is_active`` AND that the challenge
  token's ``tkv`` claim still matches ``user.token_version``, so a
  deactivation / force-logout / admin reset that lands mid-flight
  invalidates the challenge instead of being bypassed.
* ``_verify_totp_match_counter`` returns the actual step the
  submitted code matched (not always the current step), so the
  Valkey replay marker covers the right counter even when the user's
  authenticator is one step ahead or behind.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pyotp
import pytest

from uniffy.core.errors import PermissionDeniedError
from uniffy.core.types import generate_id
from uniffy.domains.auth.errors import (
    AuthenticationError,
    MfaRateLimitedError,
    TokenError,
)
from uniffy.domains.auth.mfa import operations as mfa_ops
from uniffy.domains.auth.mfa.operations import MfaOperations
from uniffy.domains.auth.mfa.limits import VerifyLockStatus


@dataclass
class _User:
    id: UUID
    email: str = "alice@example.com"
    full_name: str | None = "Alice"
    avatar_key: str | None = None
    is_active: bool = True
    token_version: int = 1


@dataclass
class _Mfa:
    user_id: UUID
    totp_secret_encrypted: str | None = "ciphertext"
    enabled: bool = False
    enrolled_at: Any = None
    last_used_at: Any = None
    last_failed_at: Any = None
    consecutive_failures: int = 0


@dataclass
class _ExecResults:
    """Mailbox of pre-canned `session.execute` results."""

    queue: list[Any] = field(default_factory=list)

    def __call__(self, *_a, **_k):
        if not self.queue:
            raise AssertionError("session.execute called more times than expected")
        return self.queue.pop(0)


def _result(*, scalar=None) -> Any:
    r = MagicMock()
    r.scalar_one_or_none = lambda: scalar
    return r


def _session(execs: list[Any]) -> MagicMock:
    session = MagicMock()
    sink = _ExecResults(queue=list(execs))

    async def execute(*a, **k):
        return sink(*a, **k)

    session.execute = AsyncMock(side_effect=execute)
    session.commit = AsyncMock()
    session.flush = AsyncMock()
    session.add = MagicMock()
    return session


class TestBeginEnrollmentRefuseWhenEnabled:
    """``BeginEnrollment`` must not overwrite an enabled row.

    Without this guard, an attacker with an active session can call
    BeginEnrollment to overwrite the secret + flip ``enabled=False``,
    silently disabling MFA without ever needing a current TOTP code.
    """

    async def test_refuses_when_mfa_already_enabled(self) -> None:
        user_id = generate_id()
        user = _User(id=user_id, is_active=True)
        mfa = _Mfa(user_id=user_id, enabled=True)
        session = _session([
            _result(scalar=user),
            _result(scalar=mfa),
        ])
        ops = MfaOperations(session, AsyncMock())

        with pytest.raises(PermissionDeniedError):
            await ops.begin_enrollment(user_id)

        session.commit.assert_not_called()
        session.add.assert_not_called()

    async def test_refuses_when_user_inactive(self) -> None:
        user_id = generate_id()
        user = _User(id=user_id, is_active=False)
        session = _session([_result(scalar=user)])
        ops = MfaOperations(session, AsyncMock())

        with pytest.raises(AuthenticationError):
            await ops.begin_enrollment(user_id)

        session.commit.assert_not_called()

    async def test_allows_pending_re_enrollment(self) -> None:
        """A row with ``enabled=False`` is the pending state; overwrite ok."""
        user_id = generate_id()
        user = _User(id=user_id, is_active=True)
        mfa = _Mfa(user_id=user_id, enabled=False)
        org_ids_result = MagicMock()
        org_ids_scalars = MagicMock()
        org_ids_scalars.all = lambda: []
        org_ids_result.scalars = lambda: org_ids_scalars
        session = _session([
            _result(scalar=user),
            _result(scalar=mfa),
            org_ids_result,
        ])
        ops = MfaOperations(session, AsyncMock())

        async def _fake_decrypt(_session, ciphertext):
            return "REUSED-SECRET-B32"

        with (
            patch.object(mfa_ops, "decrypt_totp_secret", AsyncMock(side_effect=_fake_decrypt)),
            patch.object(mfa_ops, "write_audit_event", AsyncMock(return_value=None)),
        ):
            challenge = await ops.begin_enrollment(user_id)

        assert challenge.secret_b32 == "REUSED-SECRET-B32"
        assert challenge.qr_svg_base64
        # Pending secret is reused, never overwritten -- this is what
        # makes BeginEnrollment idempotent against StrictMode / retries.
        assert mfa.totp_secret_encrypted == "ciphertext"
        assert mfa.enabled is False
        session.commit.assert_awaited_once()


class TestBeginEnrollmentIdempotent:
    """Two concurrent BeginEnrollments (StrictMode, retries) must agree.

    Without the pending-secret reuse + ``ON CONFLICT DO NOTHING`` race
    guard, the second call would either crash on a unique-constraint
    violation or end up with the DB holding one secret while the UI
    showed another (whichever HTTP response was kept). The reuse path
    makes the operation idempotent: every call returns the secret that
    is actually in the DB.
    """

    async def test_fresh_enrollment_inserts_and_returns_new_secret(self) -> None:
        user_id = generate_id()
        user = _User(id=user_id, is_active=True)
        stored_after_insert = _Mfa(
            user_id=user_id, totp_secret_encrypted="freshly-inserted", enabled=False
        )
        org_ids_scalars = MagicMock()
        org_ids_scalars.all = lambda: []
        org_ids_result = MagicMock()
        org_ids_result.scalars = lambda: org_ids_scalars
        # Order: load user, load mfa (none), upsert, re-load (now exists), org-ids
        session = _session([
            _result(scalar=user),
            _result(scalar=None),
            _result(scalar=None),
            _result(scalar=stored_after_insert),
            org_ids_result,
        ])
        session.flush = AsyncMock()
        ops = MfaOperations(session, AsyncMock())

        async def _fake_encrypt(_session, secret):
            return "freshly-inserted"

        async def _fake_decrypt(_session, ciphertext):
            return "FRESH-SECRET-B32"

        with (
            patch.object(mfa_ops, "encrypt_totp_secret", AsyncMock(side_effect=_fake_encrypt)),
            patch.object(mfa_ops, "decrypt_totp_secret", AsyncMock(side_effect=_fake_decrypt)),
            patch.object(mfa_ops, "write_audit_event", AsyncMock(return_value=None)),
        ):
            challenge = await ops.begin_enrollment(user_id)

        assert challenge.secret_b32 == "FRESH-SECRET-B32"
        session.commit.assert_awaited_once()


class TestVerifyMfaTokenBinding:
    """``VerifyMfa`` must validate ``is_active`` + the tkv binding.

    Without these checks an attacker holding a valid challenge token
    issued *before* the user was deactivated or had their token version
    bumped (force-logout, admin reset) can still mint a fresh session
    inside the 5-minute challenge window. The interceptor cannot help
    here because VerifyMfa is unauthenticated.
    """

    def _build_challenge_payload(
        self, user_id: UUID, *, tkv: int, org_id: UUID | None = None
    ) -> dict[str, Any]:
        payload = {"sub": str(user_id), "tkv": tkv, "type": "mfa_challenge"}
        if org_id:
            payload["org_id"] = str(org_id)
        return payload

    async def test_rejects_when_user_inactive(self) -> None:
        user_id = generate_id()
        user = _User(id=user_id, is_active=False, token_version=3)
        payload = self._build_challenge_payload(user_id, tkv=3)
        session = _session([_result(scalar=user)])
        ops = MfaOperations(session, AsyncMock())

        with (
            patch.object(mfa_ops, "decode_mfa_challenge_token", return_value=payload),
            patch.object(
                mfa_ops,
                "is_verify_locked",
                AsyncMock(return_value=VerifyLockStatus(False, False)),
            ),
            pytest.raises(AuthenticationError),
        ):
            await ops.verify_mfa(challenge_token="opaque", code="123456", method="totp")

    async def test_rejects_when_token_version_advanced(self) -> None:
        """tkv claim is N, but user.token_version is N+1: revoked."""
        user_id = generate_id()
        user = _User(id=user_id, is_active=True, token_version=5)
        payload = self._build_challenge_payload(user_id, tkv=4)
        session = _session([_result(scalar=user)])
        ops = MfaOperations(session, AsyncMock())

        with (
            patch.object(mfa_ops, "decode_mfa_challenge_token", return_value=payload),
            patch.object(
                mfa_ops,
                "is_verify_locked",
                AsyncMock(return_value=VerifyLockStatus(False, False)),
            ),
            pytest.raises(TokenError),
        ):
            await ops.verify_mfa(challenge_token="opaque", code="123456", method="totp")

    async def test_rejects_when_tkv_claim_missing(self) -> None:
        """A challenge token without a tkv claim is treated as revoked."""
        user_id = generate_id()
        user = _User(id=user_id, is_active=True, token_version=2)
        payload = {"sub": str(user_id), "type": "mfa_challenge"}
        session = _session([_result(scalar=user)])
        ops = MfaOperations(session, AsyncMock())

        with (
            patch.object(mfa_ops, "decode_mfa_challenge_token", return_value=payload),
            patch.object(
                mfa_ops,
                "is_verify_locked",
                AsyncMock(return_value=VerifyLockStatus(False, False)),
            ),
            pytest.raises(TokenError),
        ):
            await ops.verify_mfa(challenge_token="opaque", code="123456", method="totp")

    async def test_rate_limit_short_circuits_before_user_load(self) -> None:
        """A locked user is rejected without touching the DB."""
        user_id = generate_id()
        payload = self._build_challenge_payload(user_id, tkv=1)
        session = _session([])
        ops = MfaOperations(session, AsyncMock())

        with (
            patch.object(mfa_ops, "decode_mfa_challenge_token", return_value=payload),
            patch.object(
                mfa_ops,
                "is_verify_locked",
                AsyncMock(return_value=VerifyLockStatus(user_locked=True, ip_locked=False)),
            ),
            pytest.raises(MfaRateLimitedError),
        ):
            await ops.verify_mfa(challenge_token="opaque", code="123456", method="totp")


class TestTotpCounterDetection:
    """``_verify_totp_match_counter`` returns the actual matched step.

    Without this the replay marker would always be ``totp_counter_now()``
    and a code generated for step N+1 (clock skew, authenticator one
    step ahead) would only be marked for step N. Once the clock crosses
    into N+1, the same code would pass verify a second time because the
    N+1 replay key is fresh.
    """

    @pytest.fixture(autouse=True)
    def _patch_decrypt(self, monkeypatch) -> None:
        async def _fake(_session, ciphertext: str) -> str:
            return ciphertext  # store plaintext base32 in the test fixture

        monkeypatch.setattr(mfa_ops, "decrypt_totp_secret", _fake)

    def _build_ops(self) -> MfaOperations:
        return MfaOperations(MagicMock(), AsyncMock())

    async def test_returns_now_counter_for_current_code(self, monkeypatch) -> None:
        secret = pyotp.random_base32()
        totp = pyotp.TOTP(secret)
        now_counter = 1_000_000
        monkeypatch.setattr(mfa_ops, "totp_counter_now", lambda: now_counter)
        code = totp.generate_otp(now_counter)
        mfa = _Mfa(user_id=generate_id(), totp_secret_encrypted=secret, enabled=True)

        matched = await self._build_ops()._verify_totp_match_counter(mfa, code)

        assert matched == now_counter

    async def test_returns_future_counter_when_authenticator_ahead(self, monkeypatch) -> None:
        secret = pyotp.random_base32()
        totp = pyotp.TOTP(secret)
        now_counter = 1_000_000
        monkeypatch.setattr(mfa_ops, "totp_counter_now", lambda: now_counter)
        code = totp.generate_otp(now_counter + 1)
        mfa = _Mfa(user_id=generate_id(), totp_secret_encrypted=secret, enabled=True)

        matched = await self._build_ops()._verify_totp_match_counter(mfa, code)

        assert matched == now_counter + 1

    async def test_returns_past_counter_when_authenticator_behind(self, monkeypatch) -> None:
        secret = pyotp.random_base32()
        totp = pyotp.TOTP(secret)
        now_counter = 1_000_000
        monkeypatch.setattr(mfa_ops, "totp_counter_now", lambda: now_counter)
        code = totp.generate_otp(now_counter - 1)
        mfa = _Mfa(user_id=generate_id(), totp_secret_encrypted=secret, enabled=True)

        matched = await self._build_ops()._verify_totp_match_counter(mfa, code)

        assert matched == now_counter - 1

    async def test_returns_none_outside_window(self, monkeypatch) -> None:
        secret = pyotp.random_base32()
        totp = pyotp.TOTP(secret)
        now_counter = 1_000_000
        monkeypatch.setattr(mfa_ops, "totp_counter_now", lambda: now_counter)
        code = totp.generate_otp(now_counter + 5)
        mfa = _Mfa(user_id=generate_id(), totp_secret_encrypted=secret, enabled=True)

        matched = await self._build_ops()._verify_totp_match_counter(mfa, code)

        assert matched is None

    async def test_returns_none_for_empty_code(self) -> None:
        secret = pyotp.random_base32()
        mfa = _Mfa(user_id=generate_id(), totp_secret_encrypted=secret, enabled=True)

        assert await self._build_ops()._verify_totp_match_counter(mfa, "") is None
        assert await self._build_ops()._verify_totp_match_counter(mfa, "   ") is None

    async def test_returns_none_when_secret_missing(self) -> None:
        mfa = _Mfa(user_id=generate_id(), totp_secret_encrypted=None, enabled=False)

        assert await self._build_ops()._verify_totp_match_counter(mfa, "123456") is None


class TestAuditFanOutToOrgs:
    """Self-service MFA audit events fan out to every org the user is in.

    Without this, an org admin viewing ``/admin/audit`` has no signal
    when one of their members enrolls, disables, or regenerates MFA.
    The single ``organization_id=NULL`` audit row that the prior code
    wrote was only visible on ``/platform/audit``.
    """

    async def test_fans_out_one_row_per_active_membership(self) -> None:
        user_id = generate_id()
        org_a = generate_id()
        org_b = generate_id()
        scalars = MagicMock()
        scalars.all = lambda: [org_a, org_b]
        result = MagicMock()
        result.scalars = lambda: scalars
        session = MagicMock()
        session.execute = AsyncMock(return_value=result)
        ops = MfaOperations(session, AsyncMock())

        writer = AsyncMock(return_value=None)
        with patch.object(mfa_ops, "write_audit_event", writer):
            await ops._audit_mfa_self_event(user_id=user_id, action="auth.mfa_enrolled")

        assert writer.await_count == 2
        org_ids_written = {call.kwargs["organization_id"] for call in writer.await_args_list}
        assert org_ids_written == {org_a, org_b}
        for call in writer.await_args_list:
            assert call.kwargs["actor_user_id"] == user_id
            assert call.kwargs["action"] == "auth.mfa_enrolled"

    async def test_falls_back_to_null_org_when_user_has_no_memberships(self) -> None:
        user_id = generate_id()
        scalars = MagicMock()
        scalars.all = lambda: []
        result = MagicMock()
        result.scalars = lambda: scalars
        session = MagicMock()
        session.execute = AsyncMock(return_value=result)
        ops = MfaOperations(session, AsyncMock())

        writer = AsyncMock(return_value=None)
        with patch.object(mfa_ops, "write_audit_event", writer):
            await ops._audit_mfa_self_event(user_id=user_id, action="auth.mfa_disabled")

        writer.assert_awaited_once()
        assert writer.await_args.kwargs["organization_id"] is None
        assert writer.await_args.kwargs["actor_user_id"] == user_id


class TestRecoveryCodeConditionalUpdate:
    """``_consume_recovery_code`` must reject when the row was already used.

    The conditional ``UPDATE ... WHERE id=? AND used_at IS NULL`` is the
    only thing that stops two concurrent verify attempts with the same
    plaintext from both passing. When the UPDATE returns zero rowcount
    the helper must return ``False`` rather than the in-memory verify
    result.
    """

    async def test_returns_false_when_update_loses_race(self) -> None:
        from uniffy.core.models.login.user_recovery_code import UserRecoveryCode

        user_id = generate_id()
        # SELECT returns one matching row; the conditional UPDATE
        # afterwards reports rowcount=0 (another tx already stamped
        # used_at under us).
        row = UserRecoveryCode(id=generate_id(), user_id=user_id, code_hash="abcd")

        scalars = MagicMock()
        scalars.__iter__ = lambda self: iter([row])
        select_result = MagicMock()
        select_result.scalars = lambda: scalars

        update_result = MagicMock()
        update_result.rowcount = 0

        session = MagicMock()
        session.execute = AsyncMock(side_effect=[select_result, update_result])
        ops = MfaOperations(session, AsyncMock())

        with patch.object(mfa_ops, "verify_recovery_code", return_value=True):
            consumed = await ops._consume_recovery_code(user_id, "code")

        assert consumed is False

    async def test_returns_true_when_update_succeeds(self) -> None:
        from uniffy.core.models.login.user_recovery_code import UserRecoveryCode

        user_id = generate_id()
        row = UserRecoveryCode(id=generate_id(), user_id=user_id, code_hash="abcd")

        scalars = MagicMock()
        scalars.__iter__ = lambda self: iter([row])
        select_result = MagicMock()
        select_result.scalars = lambda: scalars

        update_result = MagicMock()
        update_result.rowcount = 1

        session = MagicMock()
        session.execute = AsyncMock(side_effect=[select_result, update_result])
        ops = MfaOperations(session, AsyncMock())

        with patch.object(mfa_ops, "verify_recovery_code", return_value=True):
            consumed = await ops._consume_recovery_code(user_id, "code")

        assert consumed is True

    async def test_returns_false_when_no_codes_match(self) -> None:
        from uniffy.core.models.login.user_recovery_code import UserRecoveryCode

        user_id = generate_id()
        row = UserRecoveryCode(id=generate_id(), user_id=user_id, code_hash="abcd")
        scalars = MagicMock()
        scalars.__iter__ = lambda self: iter([row])
        select_result = MagicMock()
        select_result.scalars = lambda: scalars

        session = MagicMock()
        session.execute = AsyncMock(side_effect=[select_result])
        ops = MfaOperations(session, AsyncMock())

        with patch.object(mfa_ops, "verify_recovery_code", return_value=False):
            consumed = await ops._consume_recovery_code(user_id, "code")

        assert consumed is False


class TestSessionRevocationReachesCalls:
    """Every MFA path that kills sessions revokes the rows the call reconciler keys on."""

    def _ops(self, user: _User, mfa: _Mfa) -> tuple[MfaOperations, MagicMock, AsyncMock]:
        session = _session([])
        lifecycle = AsyncMock()
        ops = MfaOperations(session, lifecycle)
        ops._load_user = AsyncMock(return_value=user)
        ops._load_mfa = AsyncMock(return_value=mfa)
        ops._verify_totp = AsyncMock(return_value=True)
        ops._bump_token_version = AsyncMock()
        ops._audit_mfa_self_event = AsyncMock()
        return ops, session, lifecycle

    async def test_disable_revokes_every_session_and_evicts_from_calls(self) -> None:
        user = _User(id=generate_id())
        ops, session, lifecycle = self._ops(user, _Mfa(user_id=user.id, enabled=True))
        revoked = [generate_id(), generate_id()]
        session.execute = AsyncMock()

        with (
            patch.object(mfa_ops, "revoke_user_sessions", AsyncMock(return_value=revoked)) as revoke,
            patch.object(mfa_ops, "mark_sessions_revoked", AsyncMock()) as mark,
            patch.object(mfa_ops, "mark_token_version_revoked", AsyncMock()),
        ):
            await ops.disable_mfa(user.id, "123456")

        revoke.assert_awaited_once_with(session, user.id)
        mark.assert_awaited_once_with(revoked)
        lifecycle.evict_user.assert_awaited_once_with(
            session, user.id, reason=mfa_ops.CallEvictionReason.SESSION_REVOKED
        )

    async def test_enrollment_keeps_the_callers_call_and_evicts_the_rest(self) -> None:
        user = _User(id=generate_id())
        ops, session, lifecycle = self._ops(user, _Mfa(user_id=user.id))
        ops._resolve_pending_org = AsyncMock(return_value=(None, None, None, None))
        caller_session = generate_id()
        revoked = [caller_session, generate_id()]
        commits_before_transfer: list[int] = []
        lifecycle.transfer_session.side_effect = lambda *_: commits_before_transfer.append(
            session.commit.await_count
        )

        with (
            patch.object(mfa_ops, "replace_recovery_codes", AsyncMock()),
            patch.object(mfa_ops, "revoke_user_sessions", AsyncMock(return_value=revoked)) as revoke,
            patch.object(mfa_ops, "mark_sessions_revoked", AsyncMock()),
            patch.object(mfa_ops, "mark_token_version_revoked", AsyncMock()),
        ):
            result = await ops.confirm_enrollment(
                user.id, "123456", replaced_session_id=caller_session
            )

        revoke.assert_awaited_once_with(session, user.id, keep_session_id=result.session_id)
        lifecycle.transfer_session.assert_awaited_once_with(
            session, caller_session, result.session_id
        )
        lifecycle.evict_user.assert_awaited_once_with(
            session,
            user.id,
            reason=mfa_ops.CallEvictionReason.SESSION_REVOKED,
            session_ids=revoked,
        )
        assert commits_before_transfer == [0]
