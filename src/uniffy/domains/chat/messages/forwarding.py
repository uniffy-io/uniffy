from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.chat.message import (
    ChatMessage,
    ChatMessageMetadataKey,
    ChatMessageVisibility,
    SenderType,
)
from uniffy.core.types import ContentType
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.chat.messages.operations import ChatMessageOperations
from uniffy.domains.chat.senders import SenderResolver
from uniffy.domains.files.attachments.operations import AttachmentOperations


class ChatMessageForwardingOperations:
    def __init__(self, session: AsyncSession, access: ChatAccessChecker | None = None) -> None:
        self.session = session
        self.access = access or ChatAccessChecker(session)

    async def forward_message(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        source_message_id: UUID,
        target_channel_id: UUID,
        comment: str,
        sender_name: str,
        sender_avatar: str,
    ) -> tuple[ChatMessage, str, str]:
        source, source_channel = await self._load_source(
            organization_id,
            source_message_id,
        )
        await self.access.check_access(user_id, organization_id, source_channel)
        self._require_forwardable(source)

        sender = await SenderResolver(self.session).resolve_one(
            source.sender_type,
            source.sender_id,
        )
        attachment_rows = await AttachmentOperations(self.session).list_attachments(
            user_id=user_id,
            organization_id=organization_id,
            content_type=ContentType.CHAT_MESSAGE,
            content_id=source.id,
        )

        snapshot: dict[str, Any] = {
            "sender_id": str(source.sender_id),
            "sender_type": source.sender_type.value,
            "sender_name": sender.display_name,
            "created_at": source.created_at.isoformat(),
            "content": source.content,
            "attachments": [
                {
                    "file_id": str(file.id),
                    "filename": file.filename,
                    "mime_type": file.mime_type,
                    "size_bytes": file.size_bytes,
                }
                for _attachment, file, _owner in attachment_rows
            ],
        }
        metadata = {
            ChatMessageMetadataKey.FORWARD.value: {
                "message_id": str(source.id),
                "channel_id": str(source.channel_id),
                "channel_name": source_channel.name,
                "snapshot": snapshot,
            }
        }

        return await ChatMessageOperations(self.session, self.access).send_message(
            user_id=user_id,
            organization_id=organization_id,
            channel_id=target_channel_id,
            content=comment,
            message_metadata=metadata,
            sender_name=sender_name,
            sender_avatar=sender_avatar,
        )

    async def _load_source(
        self,
        organization_id: UUID,
        source_message_id: UUID,
    ) -> tuple[ChatMessage, ChatChannel]:
        result = await self.session.execute(
            select(ChatMessage, ChatChannel)
            .join(ChatChannel, ChatChannel.id == ChatMessage.channel_id)
            .where(
                ChatMessage.id == source_message_id,
                ChatMessage.is_deleted.is_(False),
                ChatChannel.organization_id == organization_id,
            )
        )
        row = result.one_or_none()
        if row is None:
            raise NotFoundError("message", source_message_id)
        return row[0], row[1]

    @staticmethod
    def _require_forwardable(source: ChatMessage) -> None:
        metadata = source.message_metadata or {}
        if source.sender_type == SenderType.SYSTEM or (
            metadata.get("visibility") == ChatMessageVisibility.AGENT_INTERNAL
        ):
            raise ValidationError("source_message_id", "This message cannot be forwarded")
