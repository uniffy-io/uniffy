"""Audit emissions for the users domain.

admin_create / admin_update / delete / avatar flows. Hash-based email
attribution lives in ``details`` so the raw address never enters the
audit payload.
"""

import asyncio
import hashlib
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from uniffy.core.audit.actions import Action
from uniffy.core.models.login.user import User
from uniffy.domains.users.operations import UserOperations


def _audit_rows(session: MagicMock) -> list:
    return [
        call.args[0]
        for call in session.add.call_args_list
        if call.args and call.args[0].__class__.__name__ == "AuditEvent"
    ]


def _scalar(value):
    inner = MagicMock()
    inner.scalar_one_or_none.return_value = value
    return inner


def _make_user(**overrides) -> User:
    defaults = dict(
        id=uuid4(),
        email="bob@example.com",
        username="bob",
        full_name="Bob",
        hashed_password=b"$argon2id$placeholder",
        is_active=True,
        token_version=0,
    )
    defaults.update(overrides)
    return User(**defaults)


def _email_hash(email: str) -> str:
    return hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()


def test_admin_create_emits_user_invited() -> None:
    session = MagicMock()
    primary_org = uuid4()
    session.execute = AsyncMock(side_effect=[_scalar(primary_org)])
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()

    ops = UserOperations(session)
    actor = uuid4()

    asyncio.run(
        ops.admin_create(
            email="new@example.com",
            username="new",
            hashed_password="hashed",
            is_system_admin=True,
            actor_user_id=actor,
        )
    )

    rows = _audit_rows(session)
    invited = [r for r in rows if r.action == Action.USER_INVITED]
    assert len(invited) == 1
    row = invited[0]
    assert row.actor_user_id == actor
    assert row.organization_id == primary_org
    assert row.details["email_hash"] == _email_hash("new@example.com")
    assert row.details["is_system_admin"] is True


def test_admin_update_deactivation_emits_deactivated() -> None:
    user = _make_user(is_active=True)
    org = uuid4()
    session = MagicMock()
    session.execute = AsyncMock(side_effect=[_scalar(org)])
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    indexer = MagicMock()
    indexer.remove_completely = AsyncMock(return_value=None)
    indexer.index_for_all_organizations = AsyncMock(return_value=None)

    ops = UserOperations(session)
    ops._user_indexer = indexer

    with patch.object(UserOperations, "get_by_id", AsyncMock(return_value=user)), patch(
        "uniffy.domains.users.operations.invalidate_user_profile",
        AsyncMock(return_value=None),
    ), patch(
        "uniffy.domains.users.operations.publish_token_revoke",
        AsyncMock(return_value=None),
    ):
        asyncio.run(
            ops.admin_update(
                user_id=user.id,
                is_active=False,
                actor_user_id=uuid4(),
            )
        )

    rows = _audit_rows(session)
    actions = {r.action for r in rows}
    assert Action.USER_DEACTIVATED in actions
    deact = next(r for r in rows if r.action == Action.USER_DEACTIVATED)
    assert deact.resource_id == user.id


def test_admin_update_email_change_emits_hashed_pair() -> None:
    user = _make_user(email="old@example.com")
    org = uuid4()
    session = MagicMock()
    session.execute = AsyncMock(side_effect=[_scalar(org)])
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    indexer = MagicMock()
    indexer.index_for_all_organizations = AsyncMock(return_value=None)
    indexer.remove_completely = AsyncMock(return_value=None)

    ops = UserOperations(session)
    ops._user_indexer = indexer

    with patch.object(UserOperations, "get_by_id", AsyncMock(return_value=user)), patch(
        "uniffy.domains.users.operations.invalidate_user_profile",
        AsyncMock(return_value=None),
    ):
        asyncio.run(
            ops.admin_update(
                user_id=user.id,
                email="new@example.com",
                actor_user_id=uuid4(),
            )
        )

    rows = _audit_rows(session)
    email_change = [r for r in rows if r.action == Action.USER_EMAIL_CHANGED]
    assert len(email_change) == 1
    row = email_change[0]
    assert row.details["previous_email_hash"] == _email_hash("old@example.com")
    assert row.details["new_email_hash"] == _email_hash("new@example.com")
    assert "previous_email" not in row.details
    assert "new_email" not in row.details


def test_admin_update_password_change_emits_password_changed_by_admin() -> None:
    user = _make_user()
    session = MagicMock()
    session.execute = AsyncMock(side_effect=[_scalar(uuid4())])
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    indexer = MagicMock()
    indexer.index_for_all_organizations = AsyncMock(return_value=None)
    indexer.remove_completely = AsyncMock(return_value=None)

    ops = UserOperations(session)
    ops._user_indexer = indexer

    actor = uuid4()
    with patch.object(UserOperations, "get_by_id", AsyncMock(return_value=user)), patch(
        "uniffy.domains.users.operations.invalidate_user_profile",
        AsyncMock(return_value=None),
    ), patch(
        "uniffy.domains.users.operations.publish_token_revoke",
        AsyncMock(return_value=None),
    ):
        asyncio.run(
            ops.admin_update(
                user_id=user.id,
                hashed_password="new_hashed",
                actor_user_id=actor,
            )
        )

    rows = _audit_rows(session)
    pw_rows = [r for r in rows if r.action == Action.AUTH_PASSWORD_CHANGED]
    assert len(pw_rows) == 1
    assert pw_rows[0].details["initiator"] == "admin"


def test_delete_emits_user_deleted() -> None:
    user = _make_user()
    session = MagicMock()
    session.execute = AsyncMock(side_effect=[MagicMock(), _scalar(uuid4())])
    session.add = MagicMock()
    session.delete = AsyncMock()
    session.commit = AsyncMock()
    indexer = MagicMock()
    indexer.remove_completely = AsyncMock(return_value=None)

    ops = UserOperations(session)
    ops._user_indexer = indexer

    with patch.object(UserOperations, "get_by_id", AsyncMock(return_value=user)), patch(
        "uniffy.domains.users.operations.invalidate_user_profile",
        AsyncMock(return_value=None),
    ):
        asyncio.run(ops.delete(user.id, actor_user_id=uuid4()))

    rows = _audit_rows(session)
    assert len(rows) == 1
    assert rows[0].action == Action.USER_DELETED
    assert rows[0].details["email_hash"] == _email_hash(user.email)


def test_upload_avatar_emits_avatar_changed() -> None:
    user = _make_user(avatar_key=None)
    org = uuid4()
    session = MagicMock()
    session.execute = AsyncMock(side_effect=[_scalar(org)])
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()

    ops = UserOperations(session)

    with patch.object(UserOperations, "get_by_id", AsyncMock(return_value=user)), patch(
        "uniffy.domains.users.operations.s3_upload_avatar",
        AsyncMock(return_value="avatars/abc"),
    ), patch(
        "uniffy.domains.users.operations.s3_delete_avatar",
        AsyncMock(return_value=None),
    ), patch(
        "uniffy.domains.users.operations.invalidate_user_profile",
        AsyncMock(return_value=None),
    ):
        asyncio.run(ops.upload_avatar(user.id, b"img", "a.png"))

    rows = _audit_rows(session)
    assert len(rows) == 1
    assert rows[0].action == Action.USER_AVATAR_CHANGED
    assert rows[0].details["change"] == "set"
