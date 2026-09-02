"""Audit emissions for auth flows.

Login success / failure, refresh-token dedupe, session terminate, and
token-revoke fan-out. All DB and Valkey access is mocked - we assert
the writer is invoked with the right shape, and that dedupe gates
through the Valkey ``SET NX`` lock.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.audit.actions import Action
from uniffy.core.models.audit.event import AuditEvent, AuditResourceType
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.types import generate_id
from uniffy.domains.auth.errors import AuthenticationError, TokenError
from uniffy.domains.auth.mfa.enforcement import MfaRequirement, MfaRequirementResult
from uniffy.domains.auth.operations import AuthOperations

_UNKNOWN_EMAIL = "ghost@example.com"
_INVALID_CREDENTIALS = "Invalid email or password"
_SELF_INITIATOR = "self"


def _audit_rows(session: MagicMock) -> list[AuditEvent]:
    return [
        call.args[0]
        for call in session.add.call_args_list
        if call.args and isinstance(call.args[0], AuditEvent)
    ]


def _scalar(result):
    inner = MagicMock()
    inner.scalar_one_or_none.return_value = result
    return inner


def _session_for_login(user: User | None, role: OrganizationRole | None = None) -> MagicMock:
    session = MagicMock()
    user_lookup = _scalar(user)
    role_lookup = _scalar(role)
    session.execute = AsyncMock(side_effect=[user_lookup, role_lookup])
    session.add = MagicMock()
    session.commit = AsyncMock()
    return session


def _make_user(*, hashed_password: bytes = b"$argon2id$v=19$placeholder") -> User:
    return User(
        id=generate_id(),
        email="alice@example.com",
        username="alice",
        full_name="Alice",
        hashed_password=hashed_password,
        is_active=True,
        token_version=0,
    )


async def test_login_success_emits_login_success() -> None:
    user = _make_user()
    session = _session_for_login(user, OrganizationRole.MEMBER)
    ops = AuthOperations(session)

    with (
        patch("uniffy.domains.auth.operations.verify_password", return_value=True),
        patch.object(
            AuthOperations,
            "_load_user_mfa",
            AsyncMock(return_value=None),
        ),
        patch(
            "uniffy.domains.auth.operations.evaluate_mfa_requirement",
            AsyncMock(return_value=MfaRequirementResult(MfaRequirement.NOT_REQUIRED)),
        ),
        patch.object(
            AuthOperations,
            "_stage_session",
            AsyncMock(return_value=MagicMock(id=generate_id())),
        ),
        patch("uniffy.domains.auth.operations.create_access_token", return_value="atk"),
        patch("uniffy.domains.auth.operations.create_refresh_token", return_value="rtk"),
    ):
        await ops.authenticate(user.email, "pw")

    rows = _audit_rows(session)
    actions = {r.action for r in rows}
    assert Action.AUTH_LOGIN_SUCCESS in actions
    success = next(r for r in rows if r.action == Action.AUTH_LOGIN_SUCCESS)
    assert success.actor_user_id == user.id
    assert success.resource_type == AuditResourceType.USER
    assert success.details["email"] == user.email


async def test_login_failure_unknown_email_emits_failure_without_user() -> None:
    session = _session_for_login(user=None)
    ops = AuthOperations(session)

    with pytest.raises(AuthenticationError):
        await ops.authenticate(_UNKNOWN_EMAIL, "pw")

    rows = _audit_rows(session)
    assert len(rows) == 1
    failure = rows[0]
    assert failure.action == Action.AUTH_LOGIN_FAILURE
    assert failure.actor_user_id is None
    assert failure.details["email_attempted"] == _UNKNOWN_EMAIL
    assert _INVALID_CREDENTIALS in failure.details["failure_reason"]


async def test_login_failure_bad_password_carries_user_attribution() -> None:
    user = _make_user()
    session = _session_for_login(user)
    ops = AuthOperations(session)

    with (
        patch("uniffy.domains.auth.operations.verify_password", return_value=False),
        pytest.raises(AuthenticationError),
    ):
        await ops.authenticate(user.email, "wrong")

    rows = _audit_rows(session)
    assert len(rows) == 1
    failure = rows[0]
    assert failure.action == Action.AUTH_LOGIN_FAILURE
    assert failure.actor_user_id == user.id
    assert failure.details["email_attempted"] == user.email


async def test_refresh_token_emits_token_refreshed_with_dedupe() -> None:
    user = _make_user()
    session = MagicMock()
    user_lookup = _scalar(user)
    role_lookup = _scalar(OrganizationRole.MEMBER)
    session.execute = AsyncMock(side_effect=[user_lookup, role_lookup])
    session.add = MagicMock()
    session.commit = AsyncMock()
    ops = AuthOperations(session)

    valkey = MagicMock()
    valkey.set = AsyncMock(return_value=True)

    with (
        patch(
            "uniffy.domains.auth.operations.decode_refresh_token",
            return_value={
                "type": "refresh",
                "sub": str(user.id),
                "tkv": 0,
                "sid": None,
            },
        ),
        patch("uniffy.domains.auth.operations.create_access_token", return_value="atk"),
        patch("uniffy.domains.auth.operations.create_refresh_token", return_value="rtk"),
        patch("uniffy.core.audit.writer.get_ops_client", return_value=valkey),
    ):
        await ops.refresh_token("doesnt-matter")

    rows = _audit_rows(session)
    assert len(rows) == 1
    assert rows[0].action == Action.AUTH_TOKEN_REFRESHED
    args, kwargs = valkey.set.call_args
    assert args[0].endswith(f":{user.id}")
    assert kwargs["nx"] is True
    assert kwargs["ex"] == 3600


async def test_refresh_token_dedupe_suppresses_rapid_writes() -> None:
    user = _make_user()
    session = MagicMock()
    session.execute = AsyncMock(side_effect=[_scalar(user), _scalar(OrganizationRole.MEMBER)])
    session.add = MagicMock()
    session.commit = AsyncMock()
    ops = AuthOperations(session)

    valkey = MagicMock()
    valkey.set = AsyncMock(return_value=False)  # lock already held

    with (
        patch(
            "uniffy.domains.auth.operations.decode_refresh_token",
            return_value={
                "type": "refresh",
                "sub": str(user.id),
                "tkv": 0,
                "sid": None,
            },
        ),
        patch("uniffy.domains.auth.operations.create_access_token", return_value="atk"),
        patch("uniffy.domains.auth.operations.create_refresh_token", return_value="rtk"),
        patch("uniffy.core.audit.writer.get_ops_client", return_value=valkey),
    ):
        await ops.refresh_token("doesnt-matter")

    assert _audit_rows(session) == []


async def test_revoke_session_emits_session_terminated() -> None:
    user_id = generate_id()
    session_id = generate_id()
    session_record = MagicMock(id=session_id, user_id=user_id, is_revoked=False)
    session = MagicMock()
    session.execute = AsyncMock(side_effect=[_scalar(session_record)])
    session.add = MagicMock()
    session.commit = AsyncMock()
    ops = AuthOperations(session)

    await ops.revoke_session(user_id, session_id)

    rows = _audit_rows(session)
    assert len(rows) == 1
    assert rows[0].action == Action.AUTH_SESSION_TERMINATED
    assert rows[0].resource_id == session_id
    assert rows[0].details["initiator"] == _SELF_INITIATOR


async def test_revoke_other_sessions_emits_token_revoked() -> None:
    user_id = generate_id()
    current_session = generate_id()
    target_ids = [generate_id(), generate_id(), generate_id()]
    session = MagicMock()
    select_result = MagicMock()
    select_result.all = MagicMock(return_value=[(sid,) for sid in target_ids])
    update_sessions_result = MagicMock()
    update_user_result = MagicMock()
    session.execute = AsyncMock(
        side_effect=[select_result, update_sessions_result, update_user_result]
    )
    session.add = MagicMock()
    session.commit = AsyncMock()
    ops = AuthOperations(session)

    await ops.revoke_other_sessions(user_id, current_session)

    rows = _audit_rows(session)
    assert len(rows) == 1
    row = rows[0]
    assert row.action == Action.AUTH_TOKEN_REVOKED
    assert row.actor_user_id == user_id
    assert row.details["revoked_session_count"] == 3
    assert row.details["kept_session_id"] == str(current_session)


async def test_token_error_does_not_emit_audit_row() -> None:
    session = MagicMock()
    session.add = MagicMock()
    session.execute = AsyncMock()
    session.commit = AsyncMock()
    ops = AuthOperations(session)

    with (
        patch(
            "uniffy.domains.auth.operations.decode_refresh_token",
            side_effect=Exception("bad token"),
        ),
        pytest.raises(TokenError),
    ):
        await ops.refresh_token("garbage")

    assert _audit_rows(session) == []
