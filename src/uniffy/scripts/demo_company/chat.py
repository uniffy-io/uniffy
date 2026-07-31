"""Seed chat: categories, channels, direct conversations and their messages."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import select, update

from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_category import ChatChannelCategory
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.models.chat.thread import ChatThreadStats
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.domains.chat.categories.operations import ChatCategoryOperations
from uniffy.domains.chat.channels.operations import ChatChannelOperations
from uniffy.domains.chat.messages.operations import ChatMessageOperations
from uniffy.scripts.demo_company.chat_series import expand_series
from uniffy.scripts.demo_company.context import DemoContext, DomainResult
from uniffy.scripts.demo_company.loader import ChannelSpec, ChatContent, MessageSpec
from uniffy.scripts.demo_company.mentions import MentionRegistry

logger = logger.bind(component="scripts.demo_company.chat")

SEED_KEY = "demo_seed_key"


@dataclass
class _SeededMessages:
    by_key: dict[str, UUID] = field(default_factory=dict)
    by_content: dict[str, UUID] = field(default_factory=dict)


async def seed_chat(
    ctx: DemoContext,
    chat: ChatContent,
    registry: MentionRegistry,
    demo_user_id: UUID | None = None,
) -> DomainResult:
    """Conversations reference the rest of the workspace, so this runs after the other domains."""
    result = DomainResult()
    if not chat.channels and not chat.direct_messages:
        return result

    users = await _resolve_users(ctx, chat)
    category_ids = await _ensure_categories(ctx, chat.categories, result)
    series_by_channel = _expand_all_series(ctx, chat)

    for spec in chat.channels:
        messages = (*series_by_channel.get(spec.name, ()), *spec.messages)
        member_ids = [
            users[email] for email in _channel_member_emails(spec, messages) if email in users
        ]
        # The persona joins the open channels, so the demo starts on a workspace
        # that already has traffic in it. Private channels stay private.
        if demo_user_id is not None and spec.channel_type == ChannelType.PUBLIC.value:
            member_ids.append(demo_user_id)
        member_ids = list(dict.fromkeys(member_ids))
        channel_id = await _ensure_channel(ctx, spec, member_ids, category_ids, result)
        await _ensure_members(ctx, channel_id, member_ids, result)
        await _seed_messages(ctx, channel_id, spec.name, messages, users, registry, result)

    for spec in chat.direct_messages:
        participants = [users[email] for email in spec.participants if email in users]
        if len(participants) < 2:
            logger.warning(
                f"Direct conversation between {', '.join(spec.participants)} needs two known "
                f"members of this organization, skipping"
            )
            continue

        label = " and ".join(spec.participants)
        channel_id = await _ensure_direct(ctx, participants, label, result)
        await _seed_messages(ctx, channel_id, label, spec.messages, users, registry, result)

    return result


def _expand_all_series(ctx: DemoContext, chat: ChatContent) -> dict[str, tuple[MessageSpec, ...]]:
    known = {channel.name for channel in chat.channels}
    expanded: dict[str, tuple[MessageSpec, ...]] = {}

    for index, spec in enumerate(chat.series):
        if spec.channel not in known:
            logger.warning(f"Series targets #{spec.channel}, which no channel defines")
            continue
        messages = expand_series(
            spec,
            now=ctx.now,
            timezone=ctx.timezone,
            series_key=f"series:{index}",
        )
        expanded[spec.channel] = (*expanded.get(spec.channel, ()), *messages)

    if expanded:
        logger.info(
            f"Expanded {sum(len(m) for m in expanded.values())} messages "
            f"from {len(chat.series)} recurring series"
        )
    return expanded


async def _resolve_users(ctx: DemoContext, chat: ChatContent) -> dict[str, UUID]:
    emails: set[str] = set()
    for spec in chat.series:
        for variant in spec.variants:
            emails.update(sender for sender, _ in variant.messages)
    for channel in chat.channels:
        emails.update(channel.members)
        emails.update(_senders(channel.messages))
    for direct in chat.direct_messages:
        emails.update(direct.participants)
        emails.update(_senders(direct.messages))

    if not emails:
        return {}

    rows = (
        await ctx.session.execute(
            select(User.email, User.id)
            .join(OrganizationMember, OrganizationMember.user_id == User.id)
            .where(
                OrganizationMember.organization_id == ctx.organization_id,
                OrganizationMember.is_active == True,  # noqa: E712
                User.email.in_(emails),
            )
        )
    ).all()

    users = {row.email: row.id for row in rows}
    for missing in sorted(emails - set(users)):
        logger.warning(f"{missing} is not a member of this organization, their messages are skipped")
    return users


def _senders(messages: tuple[MessageSpec, ...]) -> set[str]:
    found: set[str] = set()
    for message in messages:
        found.add(message.sender)
        found.update(_senders(message.replies))
    return found


async def _ensure_categories(
    ctx: DemoContext,
    names: tuple[str, ...],
    result: DomainResult,
) -> dict[str, UUID | None]:
    ops = ChatCategoryOperations(ctx.session)
    category_ids: dict[str, UUID | None] = {}

    for name in names:
        existing = (
            await ctx.session.execute(
                select(ChatChannelCategory.id).where(
                    ChatChannelCategory.organization_id == ctx.organization_id,
                    ChatChannelCategory.name == name,
                )
            )
        ).scalars().first()
        if existing is not None:
            category_ids[name] = existing
            result.skipped += 1
            continue

        if ctx.dry_run:
            logger.info(f"[dry-run] chat category {name!r}")
            category_ids[name] = None
            result.created += 1
            continue

        category = await ops.create(
            user_id=ctx.actor_id,
            organization_id=ctx.organization_id,
            name=name,
        )
        category_ids[name] = category.id
        result.created += 1
        logger.info(f"Created chat category {name!r}")

    return category_ids


def _channel_member_emails(spec: ChannelSpec, messages: tuple[MessageSpec, ...]) -> list[str]:
    """Declared members first, then anyone who speaks: sending requires membership."""
    ordered = dict.fromkeys(spec.members)
    for email in sorted(_senders(messages)):
        ordered.setdefault(email, None)
    return list(ordered)


async def _ensure_members(
    ctx: DemoContext,
    channel_id: UUID | None,
    member_ids: list[UUID],
    result: DomainResult,
) -> None:
    """Top up membership on a channel that already exists from an earlier run."""
    if channel_id is None or ctx.dry_run or not member_ids:
        return

    present = set(
        (
            await ctx.session.execute(
                select(ChatChannelMember.user_id).where(
                    ChatChannelMember.channel_id == channel_id
                )
            )
        ).scalars().all()
    )
    missing = [member_id for member_id in member_ids if member_id not in present]
    if not missing:
        return

    await ChatChannelOperations(ctx.session).add_members(
        user_id=ctx.actor_id,
        organization_id=ctx.organization_id,
        channel_id=channel_id,
        member_user_ids=missing,
    )
    result.created += len(missing)
    logger.info(f"Added {len(missing)} members to an existing channel")


async def _ensure_channel(
    ctx: DemoContext,
    spec: ChannelSpec,
    member_ids: list[UUID],
    category_ids: dict[str, UUID | None],
    result: DomainResult,
) -> UUID | None:
    existing = (
        await ctx.session.execute(
            select(ChatChannel.id).where(
                ChatChannel.organization_id == ctx.organization_id,
                ChatChannel.name == spec.name,
                ChatChannel.is_deleted == False,  # noqa: E712
            )
        )
    ).scalars().first()
    if existing is not None:
        result.skipped += 1
        return existing

    if ctx.dry_run:
        logger.info(f"[dry-run] channel #{spec.name} ({spec.channel_type})")
        result.created += 1
        return None

    owner_id = member_ids[0] if member_ids else ctx.actor_id

    channel = await ChatChannelOperations(ctx.session).create_channel(
        user_id=owner_id,
        organization_id=ctx.organization_id,
        name=spec.name,
        channel_type=ChannelType(spec.channel_type),
        description=spec.description,
        category_id=category_ids.get(spec.category) if spec.category else None,
        member_ids=member_ids,
    )
    result.created += 1
    logger.info(f"Created channel #{spec.name}")
    return channel.id


async def _ensure_direct(
    ctx: DemoContext,
    participants: list[UUID],
    label: str,
    result: DomainResult,
) -> UUID | None:
    existing = await _find_direct(ctx, participants)
    if existing is not None:
        result.skipped += 1
        return existing

    if ctx.dry_run:
        logger.info(f"[dry-run] direct conversation between {label}")
        result.created += 1
        return None

    channel = await ChatChannelOperations(ctx.session).create_dm(
        user_id=participants[0],
        organization_id=ctx.organization_id,
        target_user_ids=participants[1:],
    )
    result.created += 1
    logger.info(f"Created direct conversation between {label}")
    return channel.id


async def _find_direct(ctx: DemoContext, participants: list[UUID]) -> UUID | None:
    """A DM matches only when its member set is exactly these participants."""
    wanted = set(participants)
    channel_type = ChannelType.DIRECT if len(wanted) == 2 else ChannelType.GROUP_DM

    candidates = (
        await ctx.session.execute(
            select(ChatChannel.id).where(
                ChatChannel.organization_id == ctx.organization_id,
                ChatChannel.channel_type == channel_type,
                ChatChannel.is_deleted == False,  # noqa: E712
            )
        )
    ).scalars().all()

    for channel_id in candidates:
        members = set(
            (
                await ctx.session.execute(
                    select(ChatChannelMember.user_id).where(
                        ChatChannelMember.channel_id == channel_id
                    )
                )
            ).scalars().all()
        )
        if members == wanted:
            return channel_id
    return None


async def _seed_messages(
    ctx: DemoContext,
    channel_id: UUID | None,
    label: str,
    messages: tuple[MessageSpec, ...],
    users: dict[str, UUID],
    registry: MentionRegistry,
    result: DomainResult,
) -> None:
    if not messages:
        return

    if ctx.dry_run or channel_id is None:
        pending = sum(1 + len(message.replies) for message in messages)
        logger.info(f"[dry-run] {pending} messages in {label}")
        result.created += pending
        return

    ops = ChatMessageOperations(ctx.session)
    seeded = await _seeded_messages(ctx, channel_id)
    stamps: dict[UUID, datetime] = {}
    root_ids: set[UUID] = set()
    replies_by_root: dict[UUID, list[UUID]] = {}

    for spec in messages:
        root_id = await _send(
            ctx, ops, channel_id, label, spec, users, registry, result, stamps, seeded
        )
        if root_id is None:
            continue
        root_ids.add(root_id)

        for reply in spec.replies:
            reply_id = await _send(
                ctx,
                ops,
                channel_id,
                label,
                reply,
                users,
                registry,
                result,
                stamps,
                seeded,
                root_id=root_id,
            )
            if reply_id is not None:
                replies_by_root.setdefault(root_id, []).append(reply_id)

    await _apply_timestamps(ctx, channel_id, stamps, root_ids, replies_by_root)


async def _seeded_messages(ctx: DemoContext, channel_id: UUID) -> _SeededMessages:
    """What this channel already holds, so a re-run adds only what is missing."""
    rows = (
        await ctx.session.execute(
            select(
                ChatMessage.id,
                ChatMessage.content,
                ChatMessage.message_metadata,
            ).where(
                ChatMessage.channel_id == channel_id,
                ChatMessage.is_deleted == False,  # noqa: E712
            )
        )
    ).all()

    seeded = _SeededMessages()
    for row in rows:
        key = (row.message_metadata or {}).get(SEED_KEY)
        if key:
            seeded.by_key[key] = row.id
        else:
            seeded.by_content.setdefault(row.content, row.id)
    return seeded


async def _send(
    ctx: DemoContext,
    ops: ChatMessageOperations,
    channel_id: UUID,
    label: str,
    spec: MessageSpec,
    users: dict[str, UUID],
    registry: MentionRegistry,
    result: DomainResult,
    stamps: dict[UUID, datetime],
    seeded: dict[str, UUID],
    root_id: UUID | None = None,
) -> UUID | None:
    sender_id = users.get(spec.sender)
    if sender_id is None:
        return None

    sent_at = ctx.now - timedelta(minutes=spec.minutes_ago)
    content = registry.rewrite(spec.text, source=label)

    # Content is the fallback identity for rows seeded before keys existed.
    existing = seeded.by_key.get(spec.key) or seeded.by_content.pop(content, None)
    if existing is not None:
        stamps[existing] = sent_at
        result.skipped += 1
        return existing

    message, _, _ = await ops.send_message(
        user_id=sender_id,
        organization_id=ctx.organization_id,
        channel_id=channel_id,
        content=content,
        root_id=root_id,
        message_metadata={SEED_KEY: spec.key},
    )
    stamps[message.id] = sent_at
    result.created += 1
    return message.id


async def _apply_timestamps(
    ctx: DemoContext,
    channel_id: UUID,
    stamps: dict[UUID, datetime],
    root_ids: set[UUID],
    replies_by_root: dict[UUID, list[UUID]],
) -> None:
    """Spread the conversation back over time; the send path always stamps `now`."""
    if not stamps:
        return

    for message_id, sent_at in stamps.items():
        await ctx.session.execute(
            update(ChatMessage)
            .where(ChatMessage.id == message_id)
            .values(created_at=sent_at, updated_at=sent_at)
        )

    last_message_at = max(stamps.values())
    root_stamps = [stamps[mid] for mid in root_ids if mid in stamps]
    await ctx.session.execute(
        update(ChatChannelStats)
        .where(ChatChannelStats.channel_id == channel_id)
        .values(
            last_message_at=last_message_at,
            last_root_message_at=max(root_stamps) if root_stamps else last_message_at,
        )
    )

    for root, reply_ids in replies_by_root.items():
        reply_stamps = [stamps[mid] for mid in reply_ids if mid in stamps]
        if not reply_stamps:
            continue
        await ctx.session.execute(
            update(ChatThreadStats)
            .where(ChatThreadStats.root_message_id == root)
            .values(last_reply_at=max(reply_stamps))
        )

    await ctx.session.commit()
