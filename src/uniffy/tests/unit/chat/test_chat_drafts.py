"""Tests for chat draft operations, send-pipeline clear, and stream decode.

The SQL surface is exercised against captured statements and mocked
sessions; the fanout is asserted via a monkeypatched publisher.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.exc import IntegrityError

# Pre-import the auth package (full chain) so its handlers module
# finishes before any other test-file import triggers a partial-init
# cycle through core.converters.
import uniffy.domains.auth  # noqa: F401
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.types import generate_id
from uniffy.domains.chat.drafts import operations as draft_ops_module
from uniffy.domains.chat.drafts.operations import (
    MAX_CLIENT_SESSION_ID_LENGTH,
    ChatDraftOperations,
)
from uniffy.domains.chat.messages import delivery as message_delivery_module
from uniffy.domains.chat.messages.limits import MAX_MESSAGE_LENGTH
from uniffy.domains.chat.streaming import events as evt
from uniffy.domains.chat.streaming.events import build_draft_changed_payload
from uniffy.domains.chat.streaming.handlers import (
    _CHANNEL_EVENT_TYPES,
    _payload_to_user_event,
)


def _make_ops(
    *,
    executed: list | None = None,
    execute_results: list | None = None,
) -> ChatDraftOperations:
    session = MagicMock()
    captured = executed if executed is not None else []

    results = list(execute_results or [])

    async def fake_execute(stmt):
        captured.append(stmt)
        if results:
            return results.pop(0)
        result = MagicMock()
        result.first.return_value = None
        result.scalar_one_or_none.return_value = None
        return result

    session.execute = fake_execute
    session.commit = AsyncMock()

    access = MagicMock()
    access.get_channel = AsyncMock(return_value=MagicMock(id=generate_id()))
    access.check_access = AsyncMock()
    return ChatDraftOperations(session, access)


def _row_result(value):
    result = MagicMock()
    result.first.return_value = value
    result.scalar_one_or_none.return_value = value
    return result


async def test_save_draft_rejects_oversized_content():
    ops = _make_ops()
    with pytest.raises(ValidationError):
        await ops.save_draft(
            generate_id(), generate_id(), generate_id(), None, "x" * (MAX_MESSAGE_LENGTH + 1)
        )


async def test_save_draft_rejects_long_client_session_id():
    ops = _make_ops()
    with pytest.raises(ValidationError):
        await ops.save_draft(
            generate_id(),
            generate_id(),
            generate_id(),
            None,
            "hello",
            client_session_id="s" * (MAX_CLIENT_SESSION_ID_LENGTH + 1),
        )


async def test_save_draft_propagates_access_denial():
    ops = _make_ops()
    ops.access.check_access = AsyncMock(side_effect=PermissionDeniedError("access", "channel"))
    with pytest.raises(PermissionDeniedError):
        await ops.save_draft(generate_id(), generate_id(), generate_id(), None, "hello")


async def test_save_draft_empty_content_routes_to_delete():
    ops = _make_ops()
    ops.delete_draft = AsyncMock(return_value=True)
    draft = await ops.save_draft(generate_id(), generate_id(), generate_id(), None, "   \n  ")
    ops.delete_draft.assert_awaited_once()
    assert draft.content == ""


async def test_save_draft_channel_branch_targets_partial_index(monkeypatch):
    executed: list = []
    ops = _make_ops(executed=executed)
    monkeypatch.setattr(draft_ops_module, "publish_user_chat_event", AsyncMock())

    await ops.save_draft(generate_id(), generate_id(), generate_id(), None, "hello")

    upsert = executed[-1]
    conflict = upsert._post_values_clause
    assert list(conflict.inferred_target_elements) == ["user_id", "channel_id"]


async def test_save_draft_thread_branch_validates_root_and_targets_thread_index(monkeypatch):
    channel_id = generate_id()
    root_id = generate_id()
    executed: list = []
    ops = _make_ops(executed=executed, execute_results=[_row_result(channel_id)])
    ops.access.get_channel = AsyncMock(return_value=MagicMock(id=channel_id))
    publish = AsyncMock()
    monkeypatch.setattr(draft_ops_module, "publish_user_chat_event", publish)

    await ops.save_draft(generate_id(), generate_id(), channel_id, root_id, "hello")

    upsert = executed[-1]
    conflict = upsert._post_values_clause
    assert list(conflict.inferred_target_elements) == [
        "user_id",
        "channel_id",
        "root_message_id",
    ]
    publish.assert_awaited_once()


async def test_save_draft_rejects_root_from_other_channel():
    channel_id = generate_id()
    ops = _make_ops(execute_results=[_row_result(generate_id())])
    ops.access.get_channel = AsyncMock(return_value=MagicMock(id=channel_id))
    with pytest.raises(NotFoundError):
        await ops.save_draft(generate_id(), generate_id(), channel_id, generate_id(), "hello")


async def test_save_draft_converts_integrity_error_without_content(monkeypatch):
    ops = _make_ops()

    async def raise_integrity(stmt):
        raise IntegrityError("INSERT INTO chat_drafts ...", {"content": "hello"}, Exception("fk"))

    ops.session.execute = raise_integrity
    ops.session.rollback = AsyncMock()
    publish = AsyncMock()
    monkeypatch.setattr(draft_ops_module, "publish_user_chat_event", publish)

    with pytest.raises(NotFoundError):
        await ops.save_draft(generate_id(), generate_id(), generate_id(), None, "hello")

    ops.session.rollback.assert_awaited_once()
    publish.assert_not_awaited()


async def test_delete_draft_no_row_returns_false_without_publish(monkeypatch):
    ops = _make_ops(execute_results=[_row_result(None)])
    publish = AsyncMock()
    monkeypatch.setattr(draft_ops_module, "publish_user_chat_event", publish)

    deleted = await ops.delete_draft(generate_id(), generate_id(), generate_id(), None)

    assert deleted is False
    publish.assert_not_awaited()


async def test_delete_draft_row_returns_true_and_publishes_once(monkeypatch):
    ops = _make_ops(execute_results=[_row_result((generate_id(),))])
    publish = AsyncMock()
    monkeypatch.setattr(draft_ops_module, "publish_user_chat_event", publish)

    deleted = await ops.delete_draft(generate_id(), generate_id(), generate_id(), None)

    assert deleted is True
    publish.assert_awaited_once()
    payload = publish.await_args.args[2]
    assert payload["deleted"] is True
    assert payload["content"] == ""


async def test_list_drafts_empty_for_non_member(monkeypatch):
    ops = _make_ops()
    monkeypatch.setattr(draft_ops_module, "is_active_member", AsyncMock(return_value=False))
    assert await ops.list_drafts(generate_id(), generate_id()) == []


async def test_clear_for_send_swallows_errors():
    ops = _make_ops()
    ops.delete_draft = AsyncMock(side_effect=RuntimeError("pg down"))
    await ops.clear_for_send(generate_id(), generate_id(), generate_id(), None)


def _make_message_ops_for_post_send() -> object:
    from uniffy.domains.chat.messages.operations import ChatMessageOperations

    ops = ChatMessageOperations(MagicMock())
    ops._index_message = AsyncMock()
    ops._update_resources = AsyncMock()
    ops._publish_unread_notifications = AsyncMock()
    ops._emit_send_notifications = AsyncMock()

    prefs_result = MagicMock()
    prefs_result.all.return_value = []
    ops.session.execute = AsyncMock(return_value=prefs_result)
    return ops


@pytest.mark.parametrize(
    ("sender_type", "expect_clear"),
    [(SenderType.USER, True), (SenderType.AGENT, False)],
)
async def test_background_post_send_clears_drafts_for_users_only(
    monkeypatch, sender_type, expect_clear
):
    ops = _make_message_ops_for_post_send()
    clear = AsyncMock()
    fake_cls = MagicMock(return_value=MagicMock(clear_for_send=clear))
    monkeypatch.setattr(message_delivery_module, "ChatDraftOperations", fake_cls)

    message = ChatMessage(
        id=generate_id(),
        channel_id=generate_id(),
        sender_id=generate_id(),
        sender_type=sender_type,
        content="hi",
        created_at=datetime.now(UTC),
    )
    channel = MagicMock(id=message.channel_id, organization_id=generate_id())

    await ops.background_post_send(message, channel, message.sender_id, None, "name", [])

    assert clear.await_count == (1 if expect_clear else 0)


def test_build_draft_changed_payload_shape():
    now = datetime.now(UTC)
    channel_id = generate_id()

    payload = build_draft_changed_payload(channel_id, None, "hi", False, now, "sess")
    assert payload == {
        "channel_id": str(channel_id),
        "content": "hi",
        "deleted": False,
        "updated_at": now.isoformat(),
        "client_session_id": "sess",
    }

    root_id = generate_id()
    with_root = build_draft_changed_payload(channel_id, root_id, "", True, now)
    assert with_root["root_message_id"] == str(root_id)
    assert with_root["deleted"] is True


def test_draft_changed_is_user_level_event():
    assert evt.DRAFT_CHANGED not in _CHANNEL_EVENT_TYPES

    now = datetime.now(UTC)
    channel_id = "chan"
    root_message_id = "root"
    content = "hello"
    client_session_id = "sess"
    decoded = _payload_to_user_event({
        "_type": evt.DRAFT_CHANGED,
        "channel_id": channel_id,
        "root_message_id": root_message_id,
        "content": content,
        "deleted": False,
        "updated_at": now.isoformat(),
        "client_session_id": client_session_id,
    })
    assert decoded is not None
    assert decoded.draft_changed.channel_id == channel_id
    assert decoded.draft_changed.root_message_id == root_message_id
    assert decoded.draft_changed.content == content
    assert decoded.draft_changed.client_session_id == client_session_id
    assert decoded.draft_changed.deleted is False
