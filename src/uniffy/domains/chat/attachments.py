from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.chat.channel import ChannelType
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.types import AccessMode, ContentRole
from uniffy.domains.chat.access import ChatAccessChecker


@dataclass(frozen=True, slots=True)
class ChatAttachmentPolicy:
    access_mode: AccessMode
    baseline_role: ContentRole | None


async def require_message_attachment_edit(
    session: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
    message_id: UUID,
) -> ChatAttachmentPolicy:
    row = (
        await session.execute(
            select(ChatMessage.channel_id, ChatMessage.sender_id).where(
                ChatMessage.id == message_id,
                ChatMessage.is_deleted.is_(False),
            )
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("ChatMessage", str(message_id))

    checker = ChatAccessChecker(session)
    channel = await checker.get_channel(row.channel_id, organization_id)
    await checker.check_access(user_id, organization_id, channel)
    if row.sender_id != user_id and not await checker.require_elevated(
        user_id,
        organization_id,
        channel.id,
    ):
        raise PermissionDeniedError("edit", "chat message")

    if channel.channel_type == ChannelType.PUBLIC:
        return ChatAttachmentPolicy(AccessMode.OPEN_TO_ORG, ContentRole.VIEWER)
    return ChatAttachmentPolicy(AccessMode.OWNER_ONLY, None)
