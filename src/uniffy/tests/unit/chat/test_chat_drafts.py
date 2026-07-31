"""Tests for chat draft operations, send-pipeline clear, and stream decode.

The SQL surface is exercised against captured statements and mocked
sessions; the fanout is asserted via a monkeypatched publisher.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

# Pre-import the auth package (full chain) so its handlers module
# finishes before any other test-file import triggers a partial-init
# cycle through core.converters.
import uniffy.domains.auth  # noqa: F401
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.domains.chat.drafts import operations as draft_ops_module
from uniffy.domains.chat.drafts.operations import (
    MAX_CLIENT_SESSION_ID_LENGTH,
    ChatDraftOperations,
)
from uniffy.domains.chat.messages.operations import MAX_MESSAGE_LENGTH
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
    access.get_channel = AsyncMock(return_value=MagicMock(id=uuid4()))
    access.check_access = AsyncMock()
    return ChatDraftOperations(session, access)


def _row_result(value):
    result = MagicMock()
    result.first.return_value = value
    result.scalar_one_or_none.return_value = value
    return result


def test_save_draft_rejects_oversized_content():
    ops = _make_ops()
    with pytest.raises(ValidationError):
        asyncio.run(
            ops.save_draft(uuid4(), uuid4(), uuid4(), None, "x" * (MAX_MESSAGE_LENGTH + 1))
        )


def test_save_draft_rejects_long_client_session_id():
    ops = _make_ops()
    with pytest.raises(ValidationError):
        asyncio.run(
            ops.save_draft(
                uuid4(),
                uuid4(),
                uuid4(),
                None,
                "hello",
                client_session_id="s" * (MAX_CLIENT_SESSION_ID_LENGTH + 1),
            )
        )


def test_save_draft_propagates_access_denial():
    ops = _make_ops()
    ops.access.check_access = AsyncMock(side_effect=PermissionDeniedError("access", "channel"))
    with pytest.raises(PermissionDeniedError):
        asyncio.run(ops.save_draft(uuid4(), uuid4(), uuid4(), None, "hello"))


def test_save_draft_empty_content_routes_to_delete():
    ops = _make_ops()
    ops.delete_draft = AsyncMock(return_value=True)
    draft = asyncio.run(ops.save_draft(uuid4(), uuid4(), uuid4(), None, "   \n  "))
    ops.delete_draft.assert_awaited_once()
    assert draft.content == ""


def test_save_draft_channel_branch_targets_partial_index(monkeypatch):
    executed: list = []
    ops = _make_ops(executed=executed)
    monkeypatch.setattr(draft_ops_module, "publish_user_chat_event", AsyncMock())

    asyncio.run(ops.save_draft(uuid4(), uuid4(), uuid4(), None, "hello"))

    upsert = executed[-1]
    conflict = upsert._post_values_clause
    assert list(conflict.inferred_target_elements) == ["user_id", "channel_id"]


def test_save_draft_thread_branch_validates_root_and_targets_thread_index(monkeypatch):
    channel_id = uuid4()
    root_id = uuid4()
    executed: list = []
    ops = _make_ops(executed=executed, execute_results=[_row_result(channel_id)])
    ops.access.get_channel = AsyncMock(return_value=MagicMock(id=channel_id))
    publish = AsyncMock()
    monkeypatch.setattr(draft_ops_module, "publish_user_chat_event", publish)

    asyncio.run(ops.save_draft(uuid4(), uuid4(), channel_id, root_id, "hello"))

    upsert = executed[-1]
    conflict = upsert._post_values_clause
    assert list(conflict.inferred_target_elements) == [
        "user_id",
        "channel_id",
        "root_message_id",
    ]
    publish.assert_awaited_once()


def test_save_draft_rejects_root_from_other_channel():
    channel_id = uuid4()
    ops = _make_ops(execute_results=[_row_result(uuid4())])
    ops.access.get_channel = AsyncMock(return_value=MagicMock(id=channel_id))
    with pytest.raises(NotFoundError):
        asyncio.run(ops.save_draft(uuid4(), uuid4(), channel_id, uuid4(), "hello"))


def test_save_draft_converts_integrity_error_without_content(monkeypatch):
    ops = _make_ops()

    async def raise_integrity(stmt):
        raise IntegrityError("INSERT INTO chat_drafts ...", {"content": "hello"}, Exception("fk"))

    ops.session.execute = raise_integrity
    ops.session.rollback = AsyncMock()
    publish = AsyncMock()
    monkeypatch.setattr(draft_ops_module, "publish_user_chat_event", publish)

    with pytest.raises(NotFoundError):
        asyncio.run(ops.save_draft(uuid4(), uuid4(), uuid4(), None, "hello"))

    ops.session.rollback.assert_awaited_once()
    publish.assert_not_awaited()


def test_delete_draft_no_row_returns_false_without_publish(monkeypatch):
    ops = _make_ops(execute_results=[_row_result(None)])
    publish = AsyncMock()
    monkeypatch.setattr(draft_ops_module, "publish_user_chat_event", publish)

    deleted = asyncio.run(ops.delete_draft(uuid4(), uuid4(), uuid4(), None))

    assert deleted is False
    publish.assert_not_awaited()


def test_delete_draft_row_returns_true_and_publishes_once(monkeypatch):
    ops = _make_ops(execute_results=[_row_result((uuid4(),))])
    publish = AsyncMock()
    monkeypatch.setattr(draft_ops_module, "publish_user_chat_event", publish)

    deleted = asyncio.run(ops.delete_draft(uuid4(), uuid4(), uuid4(), None))

    assert deleted is True
    publish.assert_awaited_once()
    payload = publish.await_args.args[2]
    assert payload["deleted"] is True
    assert payload["content"] == ""


def test_list_drafts_empty_for_non_member(monkeypatch):
    ops = _make_ops()
    monkeypatch.setattr(draft_ops_module, "is_active_member", AsyncMock(return_value=False))
    assert asyncio.run(ops.list_drafts(uuid4(), uuid4())) == []


def test_clear_for_send_swallows_errors():
    ops = _make_ops()
    ops.delete_draft = AsyncMock(side_effect=RuntimeError("pg down"))
    asyncio.run(ops.clear_for_send(uuid4(), uuid4(), uuid4(), None))


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
def test_background_post_send_clears_drafts_for_users_only(
    monkeypatch, sender_type, expect_clear
):
    ops = _make_message_ops_for_post_send()
    clear = AsyncMock()
    fake_cls = MagicMock(return_value=MagicMock(clear_for_send=clear))
    monkeypatch.setattr(draft_ops_module, "ChatDraftOperations", fake_cls)

    message = ChatMessage(
        id=uuid4(),
        channel_id=uuid4(),
        sender_id=uuid4(),
        sender_type=sender_type,
        content="hi",
        created_at=datetime.now(UTC),
    )
    channel = MagicMock(id=message.channel_id, organization_id=uuid4())

    asyncio.run(
        ops._background_post_send(message, channel, message.sender_id, None, "name", [])
    )

    assert clear.await_count == (1 if expect_clear else 0)


def test_build_draft_changed_payload_shape():
    now = datetime.now(UTC)
    channel_id = uuid4()

    payload = build_draft_changed_payload(channel_id, None, "hi", False, now, "sess")
    assert payload == {
        "channel_id": str(channel_id),
        "content": "hi",
        "deleted": False,
        "updated_at": now.isoformat(),
        "client_session_id": "sess",
    }

    root_id = uuid4()
    with_root = build_draft_changed_payload(channel_id, root_id, "", True, now)
    assert with_root["root_message_id"] == str(root_id)
    assert with_root["deleted"] is True


def test_draft_changed_is_user_level_event():
    assert evt.DRAFT_CHANGED not in _CHANNEL_EVENT_TYPES

    now = datetime.now(UTC)
    decoded = _payload_to_user_event(
        {
            "_type": evt.DRAFT_CHANGED,
            "channel_id": "chan",
            "root_message_id": "root",
            "content": "hello",
            "deleted": False,
            "updated_at": now.isoformat(),
            "client_session_id": "sess",
        }
    )
    assert decoded is not None
    assert decoded.draft_changed.channel_id == "chan"
    assert decoded.draft_changed.root_message_id == "root"
    assert decoded.draft_changed.content == "hello"
    assert decoded.draft_changed.client_session_id == "sess"
    assert decoded.draft_changed.deleted is False
