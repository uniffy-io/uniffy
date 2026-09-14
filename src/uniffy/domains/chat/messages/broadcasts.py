from re import Match
from uuid import UUID

from sqlalchemy import literal_column, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.references import INLINE_FILE_URL_PATTERN, MENTION_PATTERN
from uniffy.core.errors import NotFoundError
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.models.files.attachment import Attachment
from uniffy.core.types import ContentType
from uniffy.domains.chat.messages.converters import get_thread_reply_metadata


async def find_broadcast_peer(session: AsyncSession, message: ChatMessage) -> ChatMessage | None:
    context = get_thread_reply_metadata(message.message_metadata)
    if context is not None and message.root_id is None:
        try:
            reply_id = UUID(str(context["reply_message_id"]))
            root_id = UUID(str(context["root_message_id"]))
        except ValueError:
            return None
        condition = (ChatMessage.id == reply_id) & (ChatMessage.root_id == root_id)
    elif message.root_id is not None:
        condition = (
            literal_column("metadata -> 'thread_reply' ->> 'reply_message_id'") == str(message.id)
        ) & ChatMessage.root_id.is_(None)
    else:
        return None
    peer = (
        await session.execute(
            select(ChatMessage)
            .where(
                condition,
                ChatMessage.channel_id == message.channel_id,
                ChatMessage.sender_id == message.sender_id,
                ChatMessage.sender_type == message.sender_type,
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if peer is not None and message.root_id is not None:
        peer_context = get_thread_reply_metadata(peer.message_metadata)
        if peer_context is None or str(peer_context["root_message_id"]) != str(message.root_id):
            return None
    return peer


async def lock_message_pair(
    session: AsyncSession, message: ChatMessage
) -> tuple[ChatMessage, ChatMessage | None]:
    peer = await find_broadcast_peer(session, message)
    ids = [message.id] if peer is None else [message.id, peer.id]
    # Edits from either surface acquire the pair in the same order.
    rows = (
        (
            await session.execute(
                select(ChatMessage)
                .where(ChatMessage.channel_id == message.channel_id, ChatMessage.id.in_(ids))
                .order_by(ChatMessage.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .all()
    )
    by_id = {row.id: row for row in rows}
    if message.id not in by_id:
        raise NotFoundError("message", message.id)
    return by_id[message.id], by_id.get(peer.id) if peer is not None else None


def released_resource_content(message: ChatMessage, peer: ChatMessage | None) -> str | None:
    """The body whose mentions leave the channel resources with this delete, or None."""
    # A broadcast pair is counted once, from the reply body, so the count only
    # moves when the last of the two rows goes.
    if peer is not None and not peer.is_deleted:
        return None
    if message.root_id is None and peer is not None:
        return peer.content
    return message.content


def remap_file_references(content: str, organization_id: UUID, file_ids: dict[UUID, UUID]) -> str:
    urns = {
        f"urn:uniffy:content:FILE:{source}": f"urn:uniffy:content:FILE:{target}"
        for source, target in file_ids.items()
    }

    def replace_urn(match: Match[str]) -> str:
        full = match.group(0)
        return (
            full[: match.start(2) - match.start()]
            + urns.get(match.group(2), match.group(2))
            + full[match.end(2) - match.start() :]
        )

    def replace_url(match: Match[str]) -> str:
        try:
            org_id, file_id = UUID(match.group(1)), UUID(match.group(2))
        except ValueError:
            return match.group(0)
        if org_id != organization_id or file_id not in file_ids:
            return match.group(0)
        return match.group(0)[: match.start(2) - match.start()] + str(file_ids[file_id])

    return INLINE_FILE_URL_PATTERN.sub(replace_url, MENTION_PATTERN.sub(replace_urn, content))


async def peer_attachment_content(
    session: AsyncSession,
    *,
    organization_id: UUID,
    message: ChatMessage,
    peer: ChatMessage,
    content: str,
) -> str:
    copy = message if message.root_id is None else peer
    attachments = (
        (
            await session.execute(
                select(Attachment).where(
                    Attachment.organization_id == organization_id,
                    Attachment.content_type == ContentType.CHAT_MESSAGE,
                    Attachment.content_id.in_([message.id, peer.id]),
                )
            )
        )
        .scalars()
        .all()
    )
    reply_files = {
        attachment.source_file_id: attachment.file_id
        for attachment in attachments
        if attachment.content_id != copy.id
    }
    mapping = {}
    for attachment in attachments:
        if attachment.content_id != copy.id or attachment.source_file_id is None:
            continue
        source = reply_files.get(attachment.source_file_id, attachment.source_file_id)
        mapping[source] = attachment.file_id
    if message.id == copy.id:
        mapping = {target: source for source, target in mapping.items()}
    return remap_file_references(content, organization_id, mapping)
