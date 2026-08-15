"""Unit tests for the support session slice.

Hits validation paths + the cache TTL math + the cipher bridge + the
audit writer ContextVar merge. Pure mock-based; no DB required.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.models.platform.support_session import (
    SupportSessionScope,
    SupportSessionState,
)
from uniffy.core.types import generate_id
from uniffy.domains.platform.support_session.cache import (
    _ttl_until,
)
from uniffy.domains.platform.support_session.context import (
    ActiveSupportSession,
    active_support_session_var,
)
from uniffy.domains.platform.support_session.converters import (
    scope_from_proto,
    state_from_proto,
)
from uniffy.domains.platform.support_session.errors import (
    SupportSessionScopeError,
    SupportSessionTransitionError,
)
from uniffy.domains.platform.support_session.operations import (
    SupportSessionOperations,
    _clamp_duration,
)
from uniffy.domains.platform.support_session.policy import (
    DEFAULT_DURATION_FLOOR_MINUTES,
    deployment_default_duration_minutes,
    deployment_max_duration_minutes,
)


class TestClampDuration:
    def test_zero_falls_to_default(self) -> None:
        assert _clamp_duration(0) == deployment_default_duration_minutes()

    def test_negative_falls_to_default(self) -> None:
        assert _clamp_duration(-5) == deployment_default_duration_minutes()

    def test_above_max_clamps(self) -> None:
        ceiling = deployment_max_duration_minutes()
        assert _clamp_duration(ceiling + 10) == ceiling

    def test_inside_range_passes_through(self) -> None:
        assert _clamp_duration(45) == 45

    def test_below_floor_clamps_up_to_floor(self) -> None:
        assert _clamp_duration(1) == DEFAULT_DURATION_FLOOR_MINUTES


class TestTtlUntil:
    def test_past_expiry_returns_zero(self) -> None:
        past = datetime.now(UTC) - timedelta(minutes=5)
        assert _ttl_until(past) == 0

    def test_future_expiry_returns_seconds(self) -> None:
        future = datetime.now(UTC) + timedelta(seconds=120)
        ttl = _ttl_until(future)
        assert 115 <= ttl <= 120

    def test_clamps_to_30_minute_ceiling(self) -> None:
        far_future = datetime.now(UTC) + timedelta(hours=2)
        assert _ttl_until(far_future) == 30 * 60


class TestScopeRejection:
    async def test_request_session_rejects_read_write(self) -> None:
        """READ_WRITE must raise SupportSessionScopeError in v1."""

        async def _check() -> None:
            session_db = MagicMock()
            session_db.commit = AsyncMock()
            session_db.flush = AsyncMock()
            session_db.add = MagicMock()

            ops = SupportSessionOperations(session_db)
            ops._user_ops = MagicMock()
            ops._user_ops.require_system_admin = AsyncMock()

            with pytest.raises(SupportSessionScopeError):
                await ops.request_session(
                    actor_user_id=generate_id(),
                    organization_id=generate_id(),
                    reason="legitimate",
                    scope=SupportSessionScope.READ_WRITE,
                    duration_minutes=30,
                )

        await _check()

    async def test_request_session_rejects_empty_reason(self) -> None:
        async def _check() -> None:
            session_db = MagicMock()
            session_db.commit = AsyncMock()
            session_db.flush = AsyncMock()

            ops = SupportSessionOperations(session_db)
            ops._user_ops = MagicMock()
            ops._user_ops.require_system_admin = AsyncMock()

            with pytest.raises(ValidationError) as exc:
                await ops.request_session(
                    actor_user_id=generate_id(),
                    organization_id=generate_id(),
                    reason="   ",
                    scope=SupportSessionScope.READ_ONLY,
                    duration_minutes=30,
                )
            assert exc.value.field == "reason"

        await _check()


class TestTransitionGuard:
    def test_error_carries_state_label(self) -> None:
        err = SupportSessionTransitionError("EXPIRED", "approve")
        assert err.field == "state"
        assert "EXPIRED" in str(err) and "approve" in str(err)


class TestConverters:
    def test_scope_round_trip(self) -> None:
        from uniffy_proto.support.v1.support_consent_pb2 import (
            SupportSessionScope as ScopeProto,
        )

        assert (
            scope_from_proto(ScopeProto.SUPPORT_SESSION_SCOPE_READ_ONLY)
            is SupportSessionScope.READ_ONLY
        )
        assert (
            scope_from_proto(ScopeProto.SUPPORT_SESSION_SCOPE_READ_WRITE)
            is SupportSessionScope.READ_WRITE
        )

    def test_scope_unspecified_defaults_to_read_only(self) -> None:
        from uniffy_proto.support.v1.support_consent_pb2 import (
            SupportSessionScope as ScopeProto,
        )

        assert (
            scope_from_proto(ScopeProto.SUPPORT_SESSION_SCOPE_UNSPECIFIED)
            is SupportSessionScope.READ_ONLY
        )

    def test_state_unspecified_returns_none(self) -> None:
        from uniffy_proto.support.v1.support_consent_pb2 import (
            SupportSessionState as StateProto,
        )

        assert state_from_proto(StateProto.SUPPORT_SESSION_STATE_UNSPECIFIED) is None

    def test_state_round_trip(self) -> None:
        from uniffy_proto.support.v1.support_consent_pb2 import (
            SupportSessionState as StateProto,
        )

        assert (
            state_from_proto(StateProto.SUPPORT_SESSION_STATE_ACTIVE) is SupportSessionState.ACTIVE
        )
        assert (
            state_from_proto(StateProto.SUPPORT_SESSION_STATE_PENDING) is SupportSessionState.PENDING
        )


class TestContextVar:
    def test_default_is_none(self) -> None:
        # Reset by setting then deleting via reset for test hygiene.
        token = active_support_session_var.set(None)
        try:
            assert active_support_session_var.get() is None
        finally:
            active_support_session_var.reset(token)

    def test_set_and_get_roundtrip(self) -> None:
        marker = ActiveSupportSession(
            session_id=UUID(int=1),
            organization_id=UUID(int=2),
            support_user_id=UUID(int=3),
            scope=SupportSessionScope.READ_ONLY.value,
        )
        token = active_support_session_var.set(marker)
        try:
            value = active_support_session_var.get()
            assert value is not None
            assert value.session_id == UUID(int=1)
            assert value.scope == "READ_ONLY"
        finally:
            active_support_session_var.reset(token)


class TestCipherBridge:
    async def test_decrypt_under_session_raises_without_opt_in(self) -> None:
        """OrgCipher.decrypt default-denies under an active session."""
        from uniffy.core.crypto.org_cipher import (
            OrgCipher,
            SupportSessionCipherBridgeDenied,
        )

        async def _check() -> None:
            org_id = generate_id()
            db_session = MagicMock()
            db_session.add = MagicMock()
            db_session.execute = AsyncMock()
            db_session.commit = AsyncMock()

            cipher = OrgCipher(db_session)
            token = active_support_session_var.set(
                ActiveSupportSession(
                    session_id=generate_id(),
                    organization_id=org_id,
                    support_user_id=generate_id(),
                    scope="READ_ONLY",
                )
            )
            try:
                with pytest.raises(SupportSessionCipherBridgeDenied):
                    await cipher.decrypt(org_id, "v1:ciphertextdata")
            finally:
                active_support_session_var.reset(token)

        await _check()

    async def test_decrypt_under_different_org_is_unaffected(self) -> None:
        """A session for org A must not block decrypt for org B."""
        from uniffy.core.crypto.org_cipher import OrgCipher

        async def _check() -> None:
            db_session = MagicMock()
            db_session.execute = AsyncMock()

            cipher = OrgCipher(db_session)
            fake_fernet = MagicMock()
            fake_fernet.decrypt.return_value = b"plain"
            cipher._fernet_for = AsyncMock(return_value=fake_fernet)

            token = active_support_session_var.set(
                ActiveSupportSession(
                    session_id=generate_id(),
                    organization_id=UUID(int=11),
                    support_user_id=generate_id(),
                    scope="READ_ONLY",
                )
            )
            try:
                # Bypass cipher parse by using a real-shaped ciphertext.
                # We only assert no SupportSessionCipherBridgeDenied path.
                # The fernet.decrypt is mocked so any payload works.
                result = await cipher.decrypt(UUID(int=22), "v1:abc")
                assert result == "plain"
            finally:
                active_support_session_var.reset(token)

        await _check()


class TestAuditWriterMerge:
    def test_merge_stamps_actor_kind(self) -> None:
        """write_audit_event auto-tags details when session is active."""
        from uniffy.core.audit.writer import _merge_support_session_tag

        org_id = generate_id()
        session_id = generate_id()
        token = active_support_session_var.set(
            ActiveSupportSession(
                session_id=session_id,
                organization_id=org_id,
                support_user_id=generate_id(),
                scope="READ_ONLY",
            )
        )
        try:
            details: dict = {"foo": "bar"}
            _merge_support_session_tag(details, org_id)
            assert details["actor_kind"] == "support"
            assert details["support_session_id"] == str(session_id)
            assert details["scope"] == "READ_ONLY"
            assert details["foo"] == "bar"
        finally:
            active_support_session_var.reset(token)

    def test_merge_skips_when_no_session(self) -> None:
        from uniffy.core.audit.writer import _merge_support_session_tag

        details: dict = {"foo": "bar"}
        _merge_support_session_tag(details, generate_id())
        assert "actor_kind" not in details

    def test_merge_skips_when_session_targets_other_org(self) -> None:
        from uniffy.core.audit.writer import _merge_support_session_tag

        token = active_support_session_var.set(
            ActiveSupportSession(
                session_id=generate_id(),
                organization_id=UUID(int=11),
                support_user_id=generate_id(),
                scope="READ_ONLY",
            )
        )
        try:
            details: dict = {}
            _merge_support_session_tag(details, UUID(int=22))
            assert "actor_kind" not in details
        finally:
            active_support_session_var.reset(token)

    def test_merge_overwrites_explicit_actor_kind_under_session(self) -> None:
        """A session tag is a fact about the request, not a caller opinion.

        The merger now overwrites ``actor_kind`` unconditionally and
        moves the caller's prior value to ``actor_kind_pre`` so audit
        readers can still see the inner attribution (agent / system
        action originator).
        """
        from uniffy.core.audit.writer import _merge_support_session_tag

        org_id = generate_id()
        token = active_support_session_var.set(
            ActiveSupportSession(
                session_id=generate_id(),
                organization_id=org_id,
                support_user_id=generate_id(),
                scope="READ_ONLY",
            )
        )
        try:
            details: dict = {"actor_kind": "agent"}
            _merge_support_session_tag(details, org_id)
            assert details["actor_kind"] == "support"
            assert details["actor_kind_pre"] == "agent"
            assert details["support_session_id"]
            assert details["scope"] == "READ_ONLY"
        finally:
            active_support_session_var.reset(token)
