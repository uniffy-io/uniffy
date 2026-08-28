from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.json_codec import dumps_str, loads
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.message import (
    ChatMessage,
    ChatMessageMetadataKey,
    ChatMessageVisibility,
    SenderType,
)
from uniffy.core.types import generate_id
from uniffy.domains.chat.messages import forwarding as forwarding_module
from uniffy.domains.chat.messages.converters import forward_context_to_proto, message_to_proto
from uniffy.domains.chat.messages.projection import ForwardProjectionResolver
from uniffy.domains.chat.messages.forwarding import ChatMessageForwardingOperations
from uniffy.domains.chat.messages.operations import ChatMessageOperations
from uniffy.domains.chat.streaming import publisher as streaming_publisher

ORG_ID = generate_id()
CREATED_AT = datetime(2026, 8, 22, 14, 30, tzinfo=UTC)


def _channel(*, organization_id=ORG_ID, name="source") -> ChatChannel:
    return ChatChannel(
        organization_id=organization_id,
        owner_id=generate_id(),
        name=name,
        slug=f"{name}-{generate_id().hex[:8]}",
        channel_type=ChannelType.PRIVATE,
    )


def _source(
    channel: ChatChannel,
    *,
    sender_type: SenderType = SenderType.USER,
    metadata: dict | None = None,
) -> ChatMessage:
    return ChatMessage(
        channel_id=channel.id,
        sender_id=generate_id(),
        sender_type=sender_type,
        content="Original [[[Roadmap|urn:uniffy:content:NOTE:019c0000-0000-7000-8000-000000000001]]]",
        message_metadata=metadata,
        created_at=CREATED_AT,
        updated_at=CREATED_AT,
    )


def _operations(
    source: ChatMessage | None,
    channel: ChatChannel | None,
) -> tuple[ChatMessageForwardingOperations, MagicMock, MagicMock]:
    result = MagicMock()
    result.one_or_none.return_value = (source, channel) if source and channel else None
    session = MagicMock()
    session.execute = AsyncMock(return_value=result)
    access = MagicMock()
    access.check_access = AsyncMock()
    return ChatMessageForwardingOperations(session, access), session, access


def _patch_dependencies(
    monkeypatch: pytest.MonkeyPatch,
    *,
    attachment_rows: list | None = None,
    send_side_effect: Exception | None = None,
) -> AsyncMock:
    resolver = MagicMock()
    resolver.resolve_one = AsyncMock(return_value=SimpleNamespace(display_name="Alice Example"))
    monkeypatch.setattr(
        forwarding_module,
        "SenderResolver",
        MagicMock(return_value=resolver),
    )

    attachment_ops = MagicMock()
    attachment_ops.list_attachments = AsyncMock(return_value=attachment_rows or [])
    monkeypatch.setattr(
        forwarding_module,
        "AttachmentOperations",
        MagicMock(return_value=attachment_ops),
    )

    sent = ChatMessage(
        channel_id=generate_id(),
        sender_id=generate_id(),
        sender_type=SenderType.USER,
        content="Context for the forward",
    )
    send_message = AsyncMock(return_value=(sent, "Forwarder", "avatar"))
    if send_side_effect is not None:
        send_message.side_effect = send_side_effect
    message_ops = MagicMock()
    message_ops.send_message = send_message
    monkeypatch.setattr(
        forwarding_module,
        "ChatMessageOperations",
        MagicMock(return_value=message_ops),
    )
    return send_message


async def test_forward_captures_immutable_snapshot_and_attachment_links(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_channel = _channel(name="strategy")
    source = _source(source_channel)
    file_id = generate_id()
    file = SimpleNamespace(
        id=file_id,
        filename="roadmap.pdf",
        mime_type="application/pdf",
        size_bytes=4096,
    )
    operations, _session, access = _operations(source, source_channel)
    send_message = _patch_dependencies(
        monkeypatch,
        attachment_rows=[(SimpleNamespace(), file, None)],
    )
    user_id = generate_id()
    target_channel_id = generate_id()

    await operations.forward_message(
        user_id=user_id,
        organization_id=ORG_ID,
        source_message_id=source.id,
        target_channel_id=target_channel_id,
        comment="Context for the forward",
        sender_name="Forwarder",
        sender_avatar="avatar",
    )

    access.check_access.assert_awaited_once_with(user_id, ORG_ID, source_channel)
    kwargs = send_message.await_args.kwargs
    assert kwargs["channel_id"] == target_channel_id
    assert kwargs["content"] == "Context for the forward"
    message_metadata = kwargs["message_metadata"]
    assert loads(dumps_str(message_metadata)) == message_metadata
    forward = message_metadata[ChatMessageMetadataKey.FORWARD.value]
    assert forward["message_id"] == str(source.id)
    assert forward["channel_id"] == str(source_channel.id)
    assert forward["channel_name"] == "strategy"
    assert forward["snapshot"] == {
        "sender_id": str(source.sender_id),
        "sender_type": "USER",
        "sender_name": "Alice Example",
        "created_at": CREATED_AT.isoformat(),
        "content": source.content,
        "attachments": [
            {
                "file_id": str(file_id),
                "filename": "roadmap.pdf",
                "mime_type": "application/pdf",
                "size_bytes": 4096,
            }
        ],
    }

    captured_content = forward["snapshot"]["content"]
    source.content = "Edited later"
    assert forward["snapshot"]["content"] == captured_content


async def test_source_access_denial_stops_before_snapshot_or_send(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_channel = _channel()
    source = _source(source_channel)
    operations, _session, access = _operations(source, source_channel)
    access.check_access.side_effect = PermissionDeniedError("access", "channel")
    send_class = MagicMock()
    monkeypatch.setattr(forwarding_module, "ChatMessageOperations", send_class)

    with pytest.raises(PermissionDeniedError):
        await operations.forward_message(
            user_id=generate_id(),
            organization_id=ORG_ID,
            source_message_id=source.id,
            target_channel_id=generate_id(),
            comment="",
            sender_name="Forwarder",
            sender_avatar="",
        )

    send_class.assert_not_called()


async def test_target_send_denial_propagates_from_normal_send_pipeline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_channel = _channel()
    source = _source(source_channel)
    operations, _session, access = _operations(source, source_channel)
    send_message = _patch_dependencies(
        monkeypatch,
        send_side_effect=PermissionDeniedError("send", "channel"),
    )

    with pytest.raises(PermissionDeniedError):
        await operations.forward_message(
            user_id=generate_id(),
            organization_id=ORG_ID,
            source_message_id=source.id,
            target_channel_id=generate_id(),
            comment="",
            sender_name="Forwarder",
            sender_avatar="",
        )

    access.check_access.assert_awaited_once()
    send_message.assert_awaited_once()


async def test_missing_or_cross_org_source_is_not_found() -> None:
    operations, _session, access = _operations(None, None)

    with pytest.raises(NotFoundError):
        await operations.forward_message(
            user_id=generate_id(),
            organization_id=ORG_ID,
            source_message_id=generate_id(),
            target_channel_id=generate_id(),
            comment="",
            sender_name="Forwarder",
            sender_avatar="",
        )

    access.check_access.assert_not_awaited()


@pytest.mark.parametrize(
    ("sender_type", "metadata"),
    [
        (SenderType.SYSTEM, None),
        (
            SenderType.AGENT,
            {"visibility": ChatMessageVisibility.AGENT_INTERNAL},
        ),
    ],
)
async def test_system_and_internal_messages_cannot_be_forwarded(
    monkeypatch: pytest.MonkeyPatch,
    sender_type: SenderType,
    metadata: dict | None,
) -> None:
    source_channel = _channel()
    source = _source(source_channel, sender_type=sender_type, metadata=metadata)
    operations, _session, _access = _operations(source, source_channel)
    send_class = MagicMock()
    monkeypatch.setattr(forwarding_module, "ChatMessageOperations", send_class)

    with pytest.raises(ValidationError):
        await operations.forward_message(
            user_id=generate_id(),
            organization_id=ORG_ID,
            source_message_id=source.id,
            target_channel_id=generate_id(),
            comment="",
            sender_name="Forwarder",
            sender_avatar="",
        )

    send_class.assert_not_called()


def test_forward_metadata_projects_to_typed_proto_context() -> None:
    source_channel = _channel(name="strategy")
    source = _source(source_channel)
    forwarded = ChatMessage(
        channel_id=generate_id(),
        sender_id=generate_id(),
        sender_type=SenderType.USER,
        content="Context",
        message_metadata={
            ChatMessageMetadataKey.FORWARD.value: {
                "message_id": str(source.id),
                "channel_id": str(source_channel.id),
                "channel_name": source_channel.name,
                "snapshot": {
                    "sender_id": str(source.sender_id),
                    "sender_type": source.sender_type.value,
                    "sender_name": "Alice Example",
                    "created_at": CREATED_AT.isoformat(),
                    "content": source.content,
                    "attachments": [
                        {
                            "file_id": str(generate_id()),
                            "filename": "roadmap.pdf",
                            "mime_type": "application/pdf",
                            "size_bytes": 4096,
                        }
                    ],
                },
            }
        },
    )

    forward_context = forward_context_to_proto(forwarded.message_metadata)
    assert forward_context is not None
    proto = message_to_proto(forwarded, forward_context=forward_context)

    assert proto.is_forwarded
    assert proto.HasField("forward_context")
    assert proto.forward_context.source_message_id == str(source.id)
    assert proto.forward_context.source_channel_name == "strategy"
    assert proto.forward_context.sender_name == "Alice Example"
    assert proto.forward_context.created_at.ToDatetime(tzinfo=UTC) == CREATED_AT
    assert proto.forward_context.attachments[0].filename == "roadmap.pdf"
    assert "forward" not in proto.metadata

    restricted = message_to_proto(forwarded)
    assert restricted.is_forwarded
    assert not restricted.HasField("forward_context")
    assert "forward" not in restricted.metadata


def test_malformed_forward_metadata_does_not_break_message_conversion() -> None:
    message = ChatMessage(
        channel_id=generate_id(),
        sender_id=generate_id(),
        sender_type=SenderType.USER,
        content="hello",
        message_metadata={ChatMessageMetadataKey.FORWARD.value: "invalid"},
    )

    proto = message_to_proto(message)

    assert not proto.is_forwarded
    assert not proto.HasField("forward_context")
    assert "forward" not in proto.metadata


@pytest.mark.parametrize("allowed", [True, False])
async def test_forward_projection_requires_live_source_access(allowed: bool) -> None:
    source_channel = _channel(name="strategy")
    source = _source(source_channel)
    forwarded = ChatMessage(
        channel_id=generate_id(),
        sender_id=generate_id(),
        sender_type=SenderType.USER,
        content="Context",
        message_metadata={
            ChatMessageMetadataKey.FORWARD.value: {
                "message_id": str(source.id),
                "channel_id": str(source_channel.id),
                "channel_name": source_channel.name,
                "snapshot": {
                    "sender_id": str(source.sender_id),
                    "sender_type": source.sender_type.value,
                    "sender_name": "Alice Example",
                    "created_at": CREATED_AT.isoformat(),
                    "content": source.content,
                    "attachments": [],
                },
            }
        },
    )
    source_result = MagicMock()
    source_result.all.return_value = [
        SimpleNamespace(id=source.id, channel_id=source_channel.id)
    ]
    session = MagicMock()
    session.execute = AsyncMock(return_value=source_result)
    access = MagicMock()
    access.filter_forward_source_channel_ids = AsyncMock(
        return_value={source_channel.id} if allowed else set()
    )

    contexts = await ForwardProjectionResolver(session, access).resolve(
        user_id=generate_id(),
        organization_id=ORG_ID,
        messages=[forwarded],
    )

    assert (forwarded.id in contexts) is allowed
    access.filter_forward_source_channel_ids.assert_awaited_once()


async def test_forward_projection_hides_deleted_or_cross_org_source() -> None:
    source_channel = _channel(name="strategy")
    source = _source(source_channel)
    forwarded = ChatMessage(
        channel_id=generate_id(),
        sender_id=generate_id(),
        sender_type=SenderType.USER,
        content="Context",
        message_metadata={
            ChatMessageMetadataKey.FORWARD.value: {
                "message_id": str(source.id),
                "channel_id": str(source_channel.id),
                "channel_name": source_channel.name,
                "snapshot": {
                    "sender_id": str(source.sender_id),
                    "sender_type": source.sender_type.value,
                    "sender_name": "Alice Example",
                    "created_at": CREATED_AT.isoformat(),
                    "content": source.content,
                    "attachments": [],
                },
            }
        },
    )
    source_result = MagicMock()
    source_result.all.return_value = []
    session = MagicMock()
    session.execute = AsyncMock(return_value=source_result)
    access = MagicMock()
    access.filter_forward_source_channel_ids = AsyncMock(return_value=set())

    contexts = await ForwardProjectionResolver(session, access).resolve(
        user_id=generate_id(),
        organization_id=ORG_ID,
        messages=[forwarded],
    )

    assert contexts == {}
    called_channel_ids = access.filter_forward_source_channel_ids.await_args.args[2]
    assert called_channel_ids == set()


async def test_live_forward_event_is_personalized_without_raw_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_channel = _channel(name="strategy")
    source = _source(source_channel)
    target_channel = _channel(name="target")
    forward_metadata = {
        "message_id": str(source.id),
        "channel_id": str(source_channel.id),
        "channel_name": source_channel.name,
        "snapshot": {
            "sender_id": str(source.sender_id),
            "sender_type": source.sender_type.value,
            "sender_name": "Alice Example",
            "created_at": CREATED_AT.isoformat(),
            "content": source.content,
            "attachments": [],
        },
    }
    forwarded = ChatMessage(
        channel_id=target_channel.id,
        sender_id=generate_id(),
        sender_type=SenderType.USER,
        content="Context",
        message_metadata={ChatMessageMetadataKey.FORWARD.value: forward_metadata},
        created_at=CREATED_AT,
    )
    authorized_user_id = generate_id()
    restricted_user_id = generate_id()
    publish_personalized = AsyncMock()
    publish_shared = AsyncMock()
    monkeypatch.setattr(
        streaming_publisher,
        "publish_user_chat_events",
        publish_personalized,
    )
    monkeypatch.setattr(
        streaming_publisher,
        "publish_channel_event_to_members",
        publish_shared,
    )
    operations = ChatMessageOperations(MagicMock(), MagicMock())
    operations._resolve_forward_viewers = AsyncMock(return_value=[authorized_user_id])

    await operations._publish_send_event(
        forwarded,
        target_channel,
        forwarded.sender_id,
        None,
        CREATED_AT,
        "Forwarder",
        "",
        [authorized_user_id, restricted_user_id],
    )

    events = publish_personalized.await_args.args[0]
    payloads = {user_id: payload for user_id, _event_type, payload in events}
    assert payloads[authorized_user_id]["forward_context"] == forward_metadata
    assert "forward_context" not in payloads[restricted_user_id]
    assert payloads[restricted_user_id]["is_forwarded"] is True
    assert "forward" not in payloads[authorized_user_id].get("metadata", {})
    assert "forward" not in payloads[restricted_user_id].get("metadata", {})
    publish_shared.assert_not_awaited()
