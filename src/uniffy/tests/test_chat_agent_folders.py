"""Unit tests for agent-chat folder operations (mocked session, no live DB)."""

import asyncio
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.chat.agent_folder import ChatAgentFolder
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.domains.chat.agent_folders.operations import AgentFolderOperations


def _run(coro):
    return asyncio.run(coro)


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
        owner_id=uuid4(),
        name="Agent chat",
        slug="agent-chat",
        channel_type=ChannelType.DIRECT,
        is_agent_dm=True,
    )


class TestCreate:
    def test_rejects_empty_name(self) -> None:
        ops, _ = _build_ops([])
        with pytest.raises(ValidationError):
            _run(ops.create(uuid4(), uuid4(), "   "))

    def test_rejects_overlong_name(self) -> None:
        ops, _ = _build_ops([])
        with pytest.raises(ValidationError):
            _run(ops.create(uuid4(), uuid4(), "x" * 101))

    def test_rejects_duplicate_name(self) -> None:
        user_id, org_id = uuid4(), uuid4()
        existing = _folder(user_id, org_id, name="Work")
        ops, _ = _build_ops([_scalars_result([existing])])
        with pytest.raises(ValidationError):
            _run(ops.create(user_id, org_id, "Work"))

    def test_assigns_next_position(self) -> None:
        user_id, org_id = uuid4(), uuid4()
        existing = _folder(user_id, org_id, name="Work", position=4)
        ops, session = _build_ops([_scalars_result([existing])])
        folder = _run(ops.create(user_id, org_id, "Research"))
        assert folder.position == 5
        assert folder.name == "Research"
        session.add.assert_called_once()
        session.commit.assert_awaited()


class TestRename:
    def test_not_found(self) -> None:
        ops, _ = _build_ops([_scalar_result(None)])
        with pytest.raises(NotFoundError):
            _run(ops.rename(uuid4(), uuid4(), uuid4(), "New"))

    def test_rejects_duplicate(self) -> None:
        user_id, org_id = uuid4(), uuid4()
        folder = _folder(user_id, org_id, name="Old")
        ops, _ = _build_ops([_scalar_result(folder), _scalar_result(uuid4())])
        with pytest.raises(ValidationError):
            _run(ops.rename(user_id, org_id, folder.id, "Taken"))

    def test_renames(self) -> None:
        user_id, org_id = uuid4(), uuid4()
        folder = _folder(user_id, org_id, name="Old")
        ops, session = _build_ops([_scalar_result(folder), _scalar_result(None)])
        renamed = _run(ops.rename(user_id, org_id, folder.id, "  New  "))
        assert renamed.name == "New"
        session.commit.assert_awaited()


class TestSetChatFolder:
    def test_channel_not_found(self, monkeypatch: pytest.MonkeyPatch) -> None:
        ops, _ = _build_ops([_scalar_result(None)])
        with pytest.raises(NotFoundError):
            _run(ops.set_chat_folder(uuid4(), uuid4(), uuid4(), None))

    def test_rejects_non_agent_dm(self) -> None:
        org_id = uuid4()
        channel = _agent_dm(org_id)
        channel.is_agent_dm = False
        ops, _ = _build_ops([_scalar_result(channel)])
        with pytest.raises(ValidationError):
            _run(ops.set_chat_folder(uuid4(), org_id, channel.id, None))

    def test_rejects_foreign_folder(self) -> None:
        org_id = uuid4()
        channel = _agent_dm(org_id)
        # _get_owned finds nothing because the folder belongs to another user.
        ops, _ = _build_ops([_scalar_result(channel), _scalar_result(None)])
        with pytest.raises(NotFoundError):
            _run(ops.set_chat_folder(uuid4(), org_id, channel.id, uuid4()))

    def test_files_chat(self, monkeypatch: pytest.MonkeyPatch) -> None:
        user_id, org_id = uuid4(), uuid4()
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
        _run(ops.set_chat_folder(user_id, org_id, channel.id, folder.id))
        session.commit.assert_awaited()
        invalidate.assert_awaited_once_with(channel.id)

    def test_missing_membership(self, monkeypatch: pytest.MonkeyPatch) -> None:
        user_id, org_id = uuid4(), uuid4()
        channel = _agent_dm(org_id)
        monkeypatch.setattr(
            "uniffy.domains.chat.agent_folders.operations.invalidate_cached_member_ids",
            AsyncMock(),
        )
        ops, _ = _build_ops([_scalar_result(channel), _rowcount_result(0)])
        with pytest.raises(NotFoundError):
            _run(ops.set_chat_folder(user_id, org_id, channel.id, None))


class TestDelete:
    def test_unfiles_chats_then_deletes(self, monkeypatch: pytest.MonkeyPatch) -> None:
        user_id, org_id = uuid4(), uuid4()
        folder = _folder(user_id, org_id)
        cid_a, cid_b = uuid4(), uuid4()
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
        _run(ops.delete(user_id, org_id, folder.id))
        session.delete.assert_awaited_once_with(folder)
        session.commit.assert_awaited()
        assert invalidate.await_count == 2

    def test_not_found(self) -> None:
        ops, _ = _build_ops([_scalar_result(None)])
        with pytest.raises(NotFoundError):
            _run(ops.delete(uuid4(), uuid4(), uuid4()))
