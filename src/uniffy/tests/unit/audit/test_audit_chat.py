"""Audit moderation deletes without recording ordinary self-deletes."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.audit.actions import Action
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.types import generate_id
from uniffy.domains.chat.messages.operations import ChatMessageOperations


def _audit_rows(session: MagicMock) -> list[AuditEvent]:
    return [
        call.args[0]
        for call in session.add.call_args_list
        if call.args and isinstance(call.args[0], AuditEvent)
    ]


def _build_session() -> MagicMock:
    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    session.delete = AsyncMock()
    return session


async def test_admin_deleting_other_users_message_emits_deleted_by_admin() -> None:
    """Audit fires only when the actor is NOT the message sender."""
    sender_id = generate_id()
    admin_id = generate_id()
    org_id = generate_id()
    channel_id = generate_id()
    message = ChatMessage(
        id=generate_id(),
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

    session.execute = AsyncMock(return_value=MagicMock())

    ops = ChatMessageOperations(session, search_indexer=MagicMock())
    ops.access = MagicMock()
    ops.access.get_channel = AsyncMock(return_value=MagicMock(id=channel_id))

    with (
        patch(
            "uniffy.domains.chat.messages.mutations.lock_message_pair",
            AsyncMock(return_value=(message, None)),
        ),
        patch.object(
            ChatMessageOperations,
            "_get_message_by_id",
            AsyncMock(return_value=message),
        ),
        patch.object(
            ChatMessageOperations,
            "_require_message_action",
            AsyncMock(return_value=None),
        ),
        patch.object(
            ChatMessageOperations,
            "_get_channel_member_ids",
            AsyncMock(return_value=[]),
        ),
        patch.object(
            ChatMessageOperations,
            "decrement_resources_from_message",
            AsyncMock(return_value=None),
            create=True,
        ),
        patch(
            "uniffy.domains.files.attachments.operations."
            "AttachmentOperations.detach_all_for_content",
            AsyncMock(return_value=0),
        ),
    ):
        await ops.delete_message(admin_id, org_id, channel_id, message.id)

    rows = _audit_rows(session)
    moderation = [r for r in rows if r.action == Action.CHAT_MESSAGE_DELETED_BY_ADMIN]
    assert len(moderation) == 1
    assert moderation[0].actor_user_id == admin_id
    assert moderation[0].details["sender_id"] == str(sender_id)


async def test_self_delete_does_not_audit() -> None:
    """User deleting their own message produces no audit row."""
    user_id = generate_id()
    org_id = generate_id()
    channel_id = generate_id()
    message = ChatMessage(
        id=generate_id(),
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

    ops = ChatMessageOperations(session, search_indexer=MagicMock())
    ops.access = MagicMock()
    ops.access.get_channel = AsyncMock(return_value=MagicMock(id=channel_id))

    with (
        patch(
            "uniffy.domains.chat.messages.mutations.lock_message_pair",
            AsyncMock(return_value=(message, None)),
        ),
        patch.object(
            ChatMessageOperations,
            "_get_message_by_id",
            AsyncMock(return_value=message),
        ),
        patch.object(
            ChatMessageOperations,
            "_require_message_action",
            AsyncMock(return_value=None),
        ),
        patch.object(
            ChatMessageOperations,
            "_get_channel_member_ids",
            AsyncMock(return_value=[]),
        ),
        patch.object(
            ChatMessageOperations,
            "decrement_resources_from_message",
            AsyncMock(return_value=None),
            create=True,
        ),
        patch(
            "uniffy.domains.files.attachments.operations."
            "AttachmentOperations.detach_all_for_content",
            AsyncMock(return_value=0),
        ),
    ):
        await ops.delete_message(user_id, org_id, channel_id, message.id)

    rows = _audit_rows(session)
    assert [r for r in rows if r.action == Action.CHAT_MESSAGE_DELETED_BY_ADMIN] == []


async def test_message_attachments_are_removed_before_soft_delete_commit() -> None:
    user_id = generate_id()
    org_id = generate_id()
    channel_id = generate_id()
    message = ChatMessage(
        id=generate_id(),
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
    ops = ChatMessageOperations(session, search_indexer=MagicMock())
    ops.access = MagicMock()
    ops.access.get_channel = AsyncMock(return_value=MagicMock(id=channel_id))

    async def assert_precommit_cleanup(*_args, **_kwargs) -> int:
        assert message.is_deleted is False
        session.commit.assert_not_awaited()
        return 1

    with (
        patch(
            "uniffy.domains.chat.messages.mutations.lock_message_pair",
            AsyncMock(return_value=(message, None)),
        ),
        patch.object(
            ChatMessageOperations,
            "_get_message_by_id",
            AsyncMock(return_value=message),
        ),
        patch.object(
            ChatMessageOperations,
            "_require_message_action",
            AsyncMock(return_value=None),
        ),
        patch.object(
            ChatMessageOperations,
            "_get_channel_member_ids",
            AsyncMock(return_value=[]),
        ),
        patch(
            "uniffy.domains.files.attachments.operations."
            "AttachmentOperations.detach_all_for_content",
            AsyncMock(side_effect=assert_precommit_cleanup),
        ),
    ):
        await ops.delete_message(user_id, org_id, channel_id, message.id)

    assert message.is_deleted is True
    session.commit.assert_awaited_once()
