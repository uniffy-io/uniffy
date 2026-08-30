"""An avatar change has to reach every surface that stores its URL.

The URL carries the upload's content hash and the previous hash's objects are
deleted, so a surface left holding the old one serves a 404.
"""

from contextlib import ExitStack
from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.models.login.user import User
from uniffy.core.types import generate_id
from uniffy.domains.users.operations import UserOperations


def _result(org_ids: list) -> MagicMock:
    """Answers both shapes the operation reads: one org id, or the full list."""
    inner = MagicMock()
    inner.scalar_one_or_none.return_value = org_ids[0]
    inner.scalars.return_value.all.return_value = list(org_ids)
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


def _session(org_ids: list) -> MagicMock:
    session = MagicMock()
    session.execute = AsyncMock(return_value=_result(org_ids))
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    return session


class _Fanout:
    """The collaborators the fanout drives, patched as one unit."""

    def __init__(self) -> None:
        self.invalidate_profile = AsyncMock(return_value=None)
        self.invalidate_by_tag = AsyncMock(return_value=None)
        self.invalidate_chart = AsyncMock(return_value=None)
        self.indexer = MagicMock()
        self.indexer.return_value.index_for_organization = AsyncMock(return_value=None)

    @property
    def indexed(self) -> list:
        return self.indexer.return_value.index_for_organization.await_args_list

    def patches(self):
        return (
            patch(
                "uniffy.domains.users.operations.invalidate_user_profile",
                self.invalidate_profile,
            ),
            patch(
                "uniffy.domains.users.operations.cache_invalidate_by_tag",
                self.invalidate_by_tag,
            ),
            patch("uniffy.domains.users.operations.invalidate_chart", self.invalidate_chart),
            patch("uniffy.domains.users.operations.UserSearchIndexer", self.indexer),
        )


async def _run(method: str, user: User, org_ids: list, fanout: _Fanout) -> None:
    ops = UserOperations(_session(org_ids), MagicMock())
    storage = AsyncMock()
    with ExitStack() as stack:
        for context in (
            patch.object(UserOperations, "get_by_id", AsyncMock(return_value=user)),
            patch(
                "uniffy.domains.users.operations.s3_upload_avatar",
                AsyncMock(return_value="avatars/abc"),
            ),
            patch(
                "uniffy.domains.users.operations.s3_delete_avatar",
                AsyncMock(return_value=None),
            ),
            *fanout.patches(),
        ):
            stack.enter_context(context)
        if method == "upload":
            await ops.upload_avatar(storage, user.id, b"img", "a.png")
        else:
            await ops.delete_avatar(storage, user.id)


async def test_upload_refreshes_profile_person_chart_and_index() -> None:
    user = _make_user(avatar_key=None)
    org = generate_id()
    fanout = _Fanout()

    await _run("upload", user, [org], fanout)

    fanout.invalidate_profile.assert_awaited_once_with(user.id)
    # Person payloads are reachable only by tag; the chart key is per org.
    fanout.invalidate_by_tag.assert_awaited_once_with(f"user:{user.id}")
    fanout.invalidate_chart.assert_awaited_once_with(org)
    assert [call.args for call in fanout.indexed] == [(user, org)]


async def test_delete_refreshes_the_same_surfaces() -> None:
    user = _make_user(avatar_key="avatars/abc")
    org = generate_id()
    fanout = _Fanout()

    await _run("delete", user, [org], fanout)

    assert user.avatar_key is None
    fanout.invalidate_by_tag.assert_awaited_once_with(f"user:{user.id}")
    fanout.invalidate_chart.assert_awaited_once_with(org)
    assert [call.args for call in fanout.indexed] == [(user, org)]


async def test_every_org_the_member_belongs_to_is_refreshed() -> None:
    user = _make_user(avatar_key=None)
    orgs = [generate_id(), generate_id()]
    fanout = _Fanout()

    await _run("upload", user, orgs, fanout)

    assert [call.args[0] for call in fanout.invalidate_chart.await_args_list] == orgs
    assert [call.args[1] for call in fanout.indexed] == orgs


async def test_delete_without_an_avatar_touches_nothing() -> None:
    user = _make_user(avatar_key=None)
    fanout = _Fanout()

    await _run("delete", user, [generate_id()], fanout)

    fanout.invalidate_by_tag.assert_not_awaited()
    fanout.invalidate_chart.assert_not_awaited()
    assert fanout.indexed == []
