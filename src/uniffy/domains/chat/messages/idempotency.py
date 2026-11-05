"""Claim send identities through the message insert before staging dependent writes."""

from hashlib import sha256
from uuid import UUID

from sqlalchemy import bindparam, lambda_stmt, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import ValidationError
from uniffy.core.json_codec import dumps_bytes
from uniffy.core.models.chat.message import ChatMessage

_MESSAGE_VALUES = {column.key: bindparam(column.key) for column in ChatMessage.__table__.columns}
# Only the SQL shape is cached; each execution supplies its own bound message values.
_INSERT_MESSAGE = lambda_stmt(
    lambda: select(ChatMessage).from_statement(
        insert(ChatMessage)
        .values(_MESSAGE_VALUES)
        .on_conflict_do_nothing(
            index_elements=["channel_id", "sender_id", "client_message_id"],
            index_where=text("client_message_id IS NOT NULL"),
        )
        .returning(ChatMessage)
    ),
    enable_tracking=False,
)


def send_fingerprint(
    content: str,
    root_id: UUID | None,
    reply_to_id: UUID | None,
    metadata: dict | None,
    attachment_ids: list[UUID] | None,
    broadcast: bool,
) -> str:
    payload = [
        content,
        str(root_id) if root_id else None,
        str(reply_to_id) if reply_to_id else None,
        sorted((metadata or {}).items()),
        [str(value) for value in dict.fromkeys(attachment_ids or [])],
        broadcast,
    ]
    return sha256(dumps_bytes(payload)).hexdigest()


async def stage_sent_message(
    session: AsyncSession,
    proposed: ChatMessage,
) -> tuple[ChatMessage, bool]:
    values = proposed.model_dump()
    values["metadata"] = values.pop("message_metadata")
    inserted = await session.scalar(_INSERT_MESSAGE, values)
    if inserted is not None:
        return inserted, True
    message = await session.scalar(
        select(ChatMessage).where(
            ChatMessage.channel_id == proposed.channel_id,
            ChatMessage.sender_id == proposed.sender_id,
            ChatMessage.client_message_id == proposed.client_message_id,
        )
    )
    if message is None or message.is_deleted:
        raise ValidationError("client_message_id", "Previously sent message was deleted")
    if message.request_fingerprint != proposed.request_fingerprint:
        raise ValidationError("client_message_id", "Client ID belongs to another send")
    return message, False
