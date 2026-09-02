"""Import large chat histories without emitting live-message side effects."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import func, select, update

from uniffy.core.models.chat.channel import (
    ChannelType,
    ChatChannel,
    ChatChannelStats,
)
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.models.login.user import User
from uniffy.core.types import AccessMode, ContentRole, generate_id
from uniffy.domains.chat.reads.operations import ChatReadStateOperations
from uniffy.scripts.demo_company.context import DemoContext, DomainResult
from uniffy.scripts.demo_company.loader import DEMO_MESSAGE_KEY, MessageSpec
from uniffy.scripts.demo_company.mentions import MentionRegistry

logger = logger.bind(component="scripts.demo_company.chat_history")

HISTORY_IMPORT_MIN_MESSAGES = 10_000
HISTORY_BATCH_SIZE = 1_000


@dataclass(frozen=True)
class _ImportedMessage:
    id: UUID
    sender_id: UUID
    content: str
    created_at: datetime


def should_import_history(messages: tuple[MessageSpec, ...]) -> bool:
    return len(messages) >= HISTORY_IMPORT_MIN_MESSAGES and all(
        not message.replies for message in messages
    )


async def seed_message_history(
    ctx: DemoContext,
    channel_id: UUID,
    label: str,
    messages: tuple[MessageSpec, ...],
    users: dict[str, UUID],
    registry: MentionRegistry,
    result: DomainResult,
) -> None:
    existing_rows = (
        await ctx.session.execute(
            select(
                ChatMessage.id,
                ChatMessage.message_metadata,
            ).where(
                ChatMessage.channel_id == channel_id,
                ChatMessage.message_metadata[DEMO_MESSAGE_KEY].as_string().is_not(None),
                ChatMessage.is_deleted.is_(False),
            )
        )
    ).all()
    existing = {
        metadata[DEMO_MESSAGE_KEY]: message_id
        for message_id, metadata in existing_rows
        if metadata and metadata.get(DEMO_MESSAGE_KEY)
    }

    imported: list[_ImportedMessage] = []
    new_rows: list[ChatMessage] = []
    existing_stamps: dict[UUID, datetime] = {}
    for spec in messages:
        sender_id = users.get(spec.sender)
        if sender_id is None:
            continue
        created_at = ctx.now - timedelta(minutes=spec.minutes_ago)
        content = registry.rewrite(spec.text, source=label)
        message_id = existing.get(spec.key)
        if message_id is None:
            message_id = generate_id()
            new_rows.append(
                ChatMessage(
                    id=message_id,
                    channel_id=channel_id,
                    sender_id=sender_id,
                    sender_type=SenderType.USER,
                    content=content,
                    message_metadata={DEMO_MESSAGE_KEY: spec.key},
                    created_at=created_at,
                    updated_at=created_at,
                )
            )
            result.created += 1
        else:
            existing_stamps[message_id] = created_at
            result.skipped += 1
        imported.append(_ImportedMessage(message_id, sender_id, content, created_at))

    for chunk in _chunks(new_rows):
        ctx.session.add_all(chunk)
        await ctx.session.flush()
    await _retime_existing(ctx, existing_stamps)
    await _refresh_stats(ctx, channel_id)
    await ctx.session.commit()

    channel = (
        await ctx.session.execute(select(ChatChannel).where(ChatChannel.id == channel_id))
    ).scalar_one()
    member_ids = list(
        (
            await ctx.session.execute(
                select(ChatChannelMember.user_id).where(
                    ChatChannelMember.channel_id == channel_id,
                    ChatChannelMember.user_id.is_not(None),
                )
            )
        )
        .scalars()
        .all()
    )
    await _index_history(ctx, channel, member_ids, imported)
    await _mark_history_read(ctx, channel_id, member_ids)
    logger.info(
        f"Imported {len(imported)} historical messages in #{label}: "
        f"{len(new_rows)} inserted, {len(existing_stamps)} retimed"
    )


def _chunks[T](items: list[T]) -> list[list[T]]:
    return [
        items[start : start + HISTORY_BATCH_SIZE]
        for start in range(0, len(items), HISTORY_BATCH_SIZE)
    ]


async def _retime_existing(ctx: DemoContext, stamps: dict[UUID, datetime]) -> None:
    ids = list(stamps)
    for id_chunk in _chunks(ids):
        rows = list(
            (await ctx.session.execute(select(ChatMessage).where(ChatMessage.id.in_(id_chunk))))
            .scalars()
            .all()
        )
        for row in rows:
            row.created_at = stamps[row.id]
            row.updated_at = stamps[row.id]


async def _refresh_stats(ctx: DemoContext, channel_id: UUID) -> None:
    total, roots, latest, latest_root = (
        await ctx.session.execute(
            select(
                func.count(ChatMessage.id),
                func.count(ChatMessage.id).filter(ChatMessage.root_id.is_(None)),
                func.max(ChatMessage.created_at),
                func.max(ChatMessage.created_at).filter(ChatMessage.root_id.is_(None)),
            ).where(
                ChatMessage.channel_id == channel_id,
                ChatMessage.is_deleted.is_(False),
            )
        )
    ).one()
    await ctx.session.execute(
        update(ChatChannelStats)
        .where(ChatChannelStats.channel_id == channel_id)
        .values(
            message_count=total,
            root_message_count=roots,
            last_message_at=latest,
            last_root_message_at=latest_root,
        )
    )


async def _index_history(
    ctx: DemoContext,
    channel: ChatChannel,
    member_ids: list[UUID],
    imported: list[_ImportedMessage],
) -> None:
    sender_ids = {message.sender_id for message in imported}
    sender_names = dict(
        (
            await ctx.session.execute(select(User.id, User.full_name).where(User.id.in_(sender_ids)))
        ).all()
    )
    public = channel.channel_type == ChannelType.PUBLIC
    for chunk in _chunks(imported):
        await ctx.search_indexer.batch_index([
            {
                "urn": f"urn:uniffy:content:CHAT_MESSAGE:{message.id}",
                "organization_id": ctx.organization_id,
                "title": message.content[:120],
                "entity_type": "chat_message",
                "url_path": f"/chat/{channel.id}#{message.id}",
                "owner_id": message.sender_id,
                "access_mode": (AccessMode.OPEN_TO_ORG if public else AccessMode.EXPLICIT_MEMBERS),
                "baseline_role": ContentRole.VIEWER if public else None,
                "keywords": message.content,
                "description": message.content[:300],
                "shared_user_ids": None if public else member_ids,
                "metadata": {
                    "channel_id": str(channel.id),
                    "channel_name": channel.name,
                    "channel_type": channel.channel_type.value,
                    "sender_id": str(message.sender_id),
                    "sender_name": sender_names.get(message.sender_id, ""),
                    "parent_label": f"#{channel.name}",
                },
            }
            for message in chunk
        ])


async def _mark_history_read(
    ctx: DemoContext,
    channel_id: UUID,
    member_ids: list[UUID],
) -> None:
    latest_id = (
        (
            await ctx.session.execute(
                select(ChatMessage.id)
                .where(
                    ChatMessage.channel_id == channel_id,
                    ChatMessage.is_deleted.is_(False),
                )
                .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
                .limit(1)
            )
        )
        .scalars()
        .first()
    )
    if latest_id is None:
        return
    reads = ChatReadStateOperations(ctx.session)
    for user_id in member_ids:
        await reads.mark_channel_read(user_id, channel_id, latest_id)
