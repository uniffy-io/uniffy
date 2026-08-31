"""Audit emissions for the users domain avatar flows."""

from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.audit.actions import Action
from uniffy.core.models.login.user import User
from uniffy.core.types import generate_id
from uniffy.domains.users.operations import UserOperations


def _audit_rows(session: MagicMock) -> list:
    return [
        call.args[0]
        for call in session.add.call_args_list
        if call.args and call.args[0].__class__.__name__ == "AuditEvent"
    ]


def _result(org_id) -> MagicMock:
    """Answers both shapes the operation reads: one org id, or the full list."""
    inner = MagicMock()
    inner.scalar_one_or_none.return_value = org_id
    inner.scalars.return_value.all.return_value = [org_id]
    return inner


def _make_user(**overrides) -> User:
    defaults = dict(
        id=generate_id(),
        email="bob@example.com",
        username="bob",
        full_name="Bob",
        hashed_password=b"$argon2id$placeholder",
        is_active=True,
        token_version=0,
    )
    defaults.update(overrides)
    return User(**defaults)


async def test_upload_avatar_emits_avatar_changed() -> None:
    user = _make_user(avatar_key=None)
    org = generate_id()
    session = MagicMock()
    session.execute = AsyncMock(return_value=_result(org))
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()

    ops = UserOperations(session, MagicMock())

    with (
        patch.object(UserOperations, "get_by_id", AsyncMock(return_value=user)),
        patch(
            "uniffy.domains.users.operations.s3_upload_avatar",
            AsyncMock(return_value="avatars/abc"),
        ),
        patch(
            "uniffy.domains.users.operations.s3_delete_avatar",
            AsyncMock(return_value=None),
        ),
        patch(
            "uniffy.domains.users.operations.invalidate_user_profile",
            AsyncMock(return_value=None),
        ),
        patch("uniffy.domains.users.operations.refresh_global_user", AsyncMock()),
    ):
        await ops.upload_avatar(AsyncMock(), user.id, b"img", "a.png")

    rows = _audit_rows(session)
    assert len(rows) == 1
    assert rows[0].action == Action.USER_AVATAR_CHANGED
    assert rows[0].details["change"] == "set"
