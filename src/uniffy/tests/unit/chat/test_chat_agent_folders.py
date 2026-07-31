"""Unit tests for agent-chat folder operations (mocked session, no live DB)."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.chat.agent_folder import ChatAgentFolder
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.types import generate_id
from uniffy.domains.chat.agent_folders.operations import AgentFolderOperations


def _scalars_result(items):
    result = MagicMock()
    result.scalars.return_value.all.return_value = items
    return result


def _scalar_result(value):
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    return result


def _rowcount_result(count):
    result = MagicMock()
    result.rowcount = count
    return result


def _build_ops(execute_results):
    session = MagicMock()
    session.execute = AsyncMock(side_effect=execute_results)
    session.add = MagicMock()
    session.delete = AsyncMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    return AgentFolderOperations(session), session


def _folder(user_id, org_id, name="Work", position=0):
    return ChatAgentFolder(
        organization_id=org_id, user_id=user_id, name=name, position=position
    )


def _agent_dm(org_id):
    return ChatChannel(
        organization_id=org_id,
        owner_id=generate_id(),
        name="Agent chat",
        slug="agent-chat",
        channel_type=ChannelType.DIRECT,
        is_agent_dm=True,
    )


class TestCreate:
    async def test_rejects_empty_name(self) -> None:
        ops, _ = _build_ops([])
        with pytest.raises(ValidationError):
            await ops.create(generate_id(), generate_id(), "   ")

    async def test_rejects_overlong_name(self) -> None:
        ops, _ = _build_ops([])
        with pytest.raises(ValidationError):
            await ops.create(generate_id(), generate_id(), "x" * 101)

    async def test_rejects_duplicate_name(self) -> None:
        user_id, org_id = generate_id(), generate_id()
        existing = _folder(user_id, org_id, name="Work")
        ops, _ = _build_ops([_scalars_result([existing])])
        with pytest.raises(ValidationError):
            await ops.create(user_id, org_id, "Work")

    async def test_assigns_next_position(self) -> None:
        user_id, org_id = generate_id(), generate_id()
        existing = _folder(user_id, org_id, name="Work", position=4)
        ops, session = _build_ops([_scalars_result([existing])])
        folder = await ops.create(user_id, org_id, "Research")
        assert folder.position == 5
        assert folder.name == "Research"
        session.add.assert_called_once()
        session.commit.assert_awaited()


class TestRename:
    async def test_not_found(self) -> None:
        ops, _ = _build_ops([_scalar_result(None)])
        with pytest.raises(NotFoundError):
            await ops.rename(generate_id(), generate_id(), generate_id(), "New")

    async def test_rejects_duplicate(self) -> None:
        user_id, org_id = generate_id(), generate_id()
        folder = _folder(user_id, org_id, name="Old")
        ops, _ = _build_ops([_scalar_result(folder), _scalar_result(generate_id())])
        with pytest.raises(ValidationError):
            await ops.rename(user_id, org_id, folder.id, "Taken")

    async def test_renames(self) -> None:
        user_id, org_id = generate_id(), generate_id()
        folder = _folder(user_id, org_id, name="Old")
        ops, session = _build_ops([_scalar_result(folder), _scalar_result(None)])
        renamed = await ops.rename(user_id, org_id, folder.id, "  New  ")
        assert renamed.name == "New"
        session.commit.assert_awaited()


class TestSetChatFolder:
    async def test_channel_not_found(self, monkeypatch: pytest.MonkeyPatch) -> None:
        ops, _ = _build_ops([_scalar_result(None)])
        with pytest.raises(NotFoundError):
            await ops.set_chat_folder(generate_id(), generate_id(), generate_id(), None)

    async def test_rejects_non_agent_dm(self) -> None:
        org_id = generate_id()
        channel = _agent_dm(org_id)
        channel.is_agent_dm = False
        ops, _ = _build_ops([_scalar_result(channel)])
        with pytest.raises(ValidationError):
            await ops.set_chat_folder(generate_id(), org_id, channel.id, None)

    async def test_rejects_foreign_folder(self) -> None:
        org_id = generate_id()
        channel = _agent_dm(org_id)
        # _get_owned finds nothing because the folder belongs to another user.
        ops, _ = _build_ops([_scalar_result(channel), _scalar_result(None)])
        with pytest.raises(NotFoundError):
            await ops.set_chat_folder(generate_id(), org_id, channel.id, generate_id())

    async def test_files_chat(self, monkeypatch: pytest.MonkeyPatch) -> None:
        user_id, org_id = generate_id(), generate_id()
        channel = _agent_dm(org_id)
        folder = _folder(user_id, org_id)
        invalidate = AsyncMock()
        monkeypatch.setattr(
            "uniffy.domains.chat.agent_folders.operations.invalidate_cached_member_ids",
            invalidate,
        )
        ops, session = _build_ops(
            [_scalar_result(channel), _scalar_result(folder), _rowcount_result(1)]
        )
        await ops.set_chat_folder(user_id, org_id, channel.id, folder.id)
        session.commit.assert_awaited()
        invalidate.assert_awaited_once_with(channel.id)

    async def test_missing_membership(self, monkeypatch: pytest.MonkeyPatch) -> None:
        user_id, org_id = generate_id(), generate_id()
        channel = _agent_dm(org_id)
        monkeypatch.setattr(
            "uniffy.domains.chat.agent_folders.operations.invalidate_cached_member_ids",
            AsyncMock(),
        )
        ops, _ = _build_ops([_scalar_result(channel), _rowcount_result(0)])
        with pytest.raises(NotFoundError):
            await ops.set_chat_folder(user_id, org_id, channel.id, None)


class TestDelete:
    async def test_unfiles_chats_then_deletes(self, monkeypatch: pytest.MonkeyPatch) -> None:
        user_id, org_id = generate_id(), generate_id()
        folder = _folder(user_id, org_id)
        cid_a, cid_b = generate_id(), generate_id()
        invalidate = AsyncMock()
        monkeypatch.setattr(
            "uniffy.domains.chat.agent_folders.operations.invalidate_cached_member_ids",
            invalidate,
        )
        ops, session = _build_ops(
            [
                _scalar_result(folder),
                _scalars_result([cid_a, cid_b]),
                _rowcount_result(2),
            ]
        )
        await ops.delete(user_id, org_id, folder.id)
        session.delete.assert_awaited_once_with(folder)
        session.commit.assert_awaited()
        assert invalidate.await_count == 2

    async def test_not_found(self) -> None:
        ops, _ = _build_ops([_scalar_result(None)])
        with pytest.raises(NotFoundError):
            await ops.delete(generate_id(), generate_id(), generate_id())
