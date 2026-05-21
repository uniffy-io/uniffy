"""Destructive-action audit emissions for chat.

Channel CRUD plus moderation: ``chat_message.deleted_by_admin`` only
emits when the deleter is not the message's sender. Regular self-deletes
stay unaudited because the volume is too high.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from uniffy.core.audit.actions import Action


def _audit_rows(session: MagicMock) -> list:
    return [
        call.args[0]
        for call in session.add.call_args_list
        if call.args and call.args[0].__class__.__name__ == "AuditEvent"
    ]


def _build_session() -> MagicMock:
    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    session.delete = AsyncMock()
    return session


def test_admin_deleting_other_users_message_emits_deleted_by_admin() -> None:
    """Audit fires only when the actor is NOT the message sender."""
    from datetime import UTC, datetime

    from uniffy.core.models.chat.message import ChatMessage, SenderType
    from uniffy.domains.chat.messages.operations import ChatMessageOperations

    sender_id = uuid4()
    admin_id = uuid4()
    org_id = uuid4()
    channel_id = uuid4()
    message = ChatMessage(
        id=uuid4(),
        channel_id=channel_id,
        sender_id=sender_id,
        sender_type=SenderType.USER,
        content="hi",
        is_deleted=False,
        is_pinned=False,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )

    session = _build_session()

    # delete_message executes one stats UPDATE for root messages.
    session.execute = AsyncMock(return_value=MagicMock())

    ops = ChatMessageOperations(session)
    ops.access = MagicMock()
    ops.access.get_channel = AsyncMock(return_value=MagicMock(id=channel_id))

    with patch.object(
        ChatMessageOperations,
        "_get_message_by_id",
        AsyncMock(return_value=message),
    ), patch.object(
        ChatMessageOperations,
        "_require_message_action",
        AsyncMock(return_value=None),
    ), patch.object(
        ChatMessageOperations,
        "_get_channel_member_ids",
        AsyncMock(return_value=[]),
    ), patch.object(
        ChatMessageOperations,
        "decrement_resources_from_message",
        AsyncMock(return_value=None),
        create=True,
    ):
        asyncio.run(
            ops.delete_message(admin_id, org_id, channel_id, message.id)
        )

    rows = _audit_rows(session)
    moderation = [
        r for r in rows if r.action == Action.CHAT_MESSAGE_DELETED_BY_ADMIN
    ]
    assert len(moderation) == 1
    assert moderation[0].actor_user_id == admin_id
    assert moderation[0].details["sender_id"] == str(sender_id)


def test_self_delete_does_not_audit() -> None:
    """User deleting their own message produces no audit row."""
    from datetime import UTC, datetime

    from uniffy.core.models.chat.message import ChatMessage, SenderType
    from uniffy.domains.chat.messages.operations import ChatMessageOperations

    user_id = uuid4()
    org_id = uuid4()
    channel_id = uuid4()
    message = ChatMessage(
        id=uuid4(),
        channel_id=channel_id,
        sender_id=user_id,
        sender_type=SenderType.USER,
        content="hi",
        is_deleted=False,
        is_pinned=False,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )

    session = _build_session()
    session.execute = AsyncMock(return_value=MagicMock())

    ops = ChatMessageOperations(session)
    ops.access = MagicMock()
    ops.access.get_channel = AsyncMock(return_value=MagicMock(id=channel_id))

    with patch.object(
        ChatMessageOperations,
        "_get_message_by_id",
        AsyncMock(return_value=message),
    ), patch.object(
        ChatMessageOperations,
        "_require_message_action",
        AsyncMock(return_value=None),
    ), patch.object(
        ChatMessageOperations,
        "_get_channel_member_ids",
        AsyncMock(return_value=[]),
    ), patch.object(
        ChatMessageOperations,
        "decrement_resources_from_message",
        AsyncMock(return_value=None),
        create=True,
    ):
        asyncio.run(
            ops.delete_message(user_id, org_id, channel_id, message.id)
        )

    rows = _audit_rows(session)
    assert [r for r in rows if r.action == Action.CHAT_MESSAGE_DELETED_BY_ADMIN] == []
