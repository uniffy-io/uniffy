"""Calendar room membership through the chat-owned capability."""

from unittest.mock import AsyncMock, MagicMock

from uniffy.core.types import generate_id
from uniffy.domains.chat import rooms as rooms_module
from uniffy.domains.chat.rooms import RoomMembership


async def test_sync_uses_injected_dependencies_and_preserves_order(monkeypatch) -> None:
    order: list[str] = []
    operations = MagicMock()
    operations.add_members = AsyncMock(side_effect=lambda *_args: order.append("add"))
    operations.remove_members = AsyncMock(side_effect=lambda *_args: order.append("remove"))
    constructor = MagicMock(return_value=operations)
    monkeypatch.setattr(rooms_module, "ChatChannelOperations", constructor)
    session = MagicMock()
    search_indexer = MagicMock()
    call_lifecycle = MagicMock()
    owner_id = generate_id()
    organization_id = generate_id()
    channel_id = generate_id()
    added_user_id = generate_id()
    removed_user_id = generate_id()

    membership = RoomMembership(session, search_indexer, call_lifecycle)
    await membership.sync(
        owner_id,
        organization_id,
        channel_id,
        added_user_ids=[added_user_id],
        removed_user_ids=[removed_user_id],
    )

    constructor.assert_called_once_with(
        session,
        search_indexer=search_indexer,
        call_lifecycle=call_lifecycle,
    )
    operations.add_members.assert_awaited_once_with(
        owner_id,
        organization_id,
        channel_id,
        [added_user_id],
    )
    operations.remove_members.assert_awaited_once_with(
        owner_id,
        organization_id,
        channel_id,
        [removed_user_id],
    )
    assert order == ["add", "remove"]


async def test_sync_skips_empty_changes(monkeypatch) -> None:
    operations = MagicMock()
    operations.add_members = AsyncMock()
    operations.remove_members = AsyncMock()
    monkeypatch.setattr(rooms_module, "ChatChannelOperations", MagicMock(return_value=operations))

    await RoomMembership(MagicMock(), MagicMock(), MagicMock()).sync(
        generate_id(),
        generate_id(),
        generate_id(),
        added_user_ids=[],
        removed_user_ids=[],
    )

    operations.add_members.assert_not_awaited()
    operations.remove_members.assert_not_awaited()
