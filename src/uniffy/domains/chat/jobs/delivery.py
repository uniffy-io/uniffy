"""Replay independently checkpointed chat effects from PostgreSQL."""

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from uuid import UUID

from loguru import logger
from prometheus_client import Counter
from sqlalchemy import or_, select

from uniffy.core.database import SESSION_FACTORY_CTX_KEY, SessionFactory
from uniffy.core.events.bus import stage_notification_events
from uniffy.core.jobs import enqueue_job
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.chat.delivery import ChatDelivery, ChatDeliveryEffect, ChatDeliveryStatus
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.search import SEARCH_INDEXER_CTX_KEY
from uniffy.domains.agents.bridge.triggers import stage_chat_triggers, wake_chat_triggers
from uniffy.domains.chat.cache import invalidate_cached_channel_resources
from uniffy.domains.chat.drafts.operations import ChatDraftOperations
from uniffy.domains.chat.jobs.contracts import DELIVER_CHAT_MESSAGE
from uniffy.domains.chat.messages.broadcasts import find_broadcast_peer, lock_message_pair
from uniffy.domains.chat.messages.operations import ChatMessageOperations
from uniffy.domains.chat.resources.operations import ChatResourceOperations
from uniffy.domains.chat.streaming.events import DRAFT_CHANGED, build_draft_changed_payload
from uniffy.domains.chat.streaming.publisher import publish_user_chat_events
from uniffy.domains.notifications.jobs.contracts import DELIVER_NOTIFICATION_OUTBOX

logger = logger.bind(component="chat.jobs.delivery")
MAX_DELIVERY_ATTEMPTS = 10
DELIVERY_TIMEOUT_SECONDS = 30
_RECOVERY_BATCH = 1000
DELIVERY_ATTEMPTS = Counter(
    "uniffy_chat_delivery_attempts_total", "Chat effect processing outcomes", ["effect", "outcome"]
)


async def _deliver_effect(ctx: dict[str, Any], message_id: UUID, effect: ChatDeliveryEffect) -> None:
    factory = cast(SessionFactory, ctx[SESSION_FACTORY_CTX_KEY])
    events: list[tuple[UUID, str, dict]] = []
    triggers: list[UUID] = []
    notification_ids: list[UUID] = []
    resource_types: list[str] = []
    channel_id = None
    async with factory() as session:
        message = await session.get(ChatMessage, message_id)
        peer = None
        if message is not None and effect in (
            ChatDeliveryEffect.INDEX,
            ChatDeliveryEffect.RESOURCES,
        ):
            message, peer = await lock_message_pair(session, message)
        row = await session.scalar(
            select(ChatDelivery)
            .where(
                ChatDelivery.message_id == message_id,
                ChatDelivery.effect == effect,
                ChatDelivery.status == ChatDeliveryStatus.PENDING,
                ChatDelivery.available_at <= datetime.now(UTC),
            )
            .with_for_update(skip_locked=True)
        )
        if row is None:
            return
        async with asyncio.timeout(DELIVERY_TIMEOUT_SECONDS):
            channel = await session.get(ChatChannel, message.channel_id) if message else None
            if channel is not None and channel.organization_id == row.organization_id:
                channel_id = channel.id
                ops = ChatMessageOperations(session, search_indexer=ctx[SEARCH_INDEXER_CTX_KEY])
                if effect == ChatDeliveryEffect.INDEX:
                    member_ids = await ops._get_channel_member_ids(channel.id)
                    await ops.project_message_index(message, channel, member_ids, wait=True)
                elif effect == ChatDeliveryEffect.RESOURCES and not channel.is_deleted:
                    # A surviving broadcast copy still contributes the reply's resources.
                    if not message.is_deleted or (peer is not None and not peer.is_deleted):
                        resource_types = await ChatResourceOperations(
                            session
                        ).stage_resources_from_message(
                            channel.id,
                            message.content,
                            message.sender_id,
                            at=message.created_at,
                        )
                elif not message.is_deleted and not channel.is_deleted:
                    if effect == ChatDeliveryEffect.AGENTS:
                        triggers = await stage_chat_triggers(session, message, channel)
                    elif effect == ChatDeliveryEffect.NOTIFICATIONS:
                        member_ids = await ops._get_channel_member_ids(channel.id)
                        member_ids = await ops.access.filter_viewers(
                            channel.organization_id, channel, member_ids
                        )
                        peer = await find_broadcast_peer(session, message)
                        with stage_notification_events(session) as notification_ids:
                            events = await ops.prepare_delivery_notifications(
                                message,
                                channel,
                                message.sender_id,
                                message.root_id,
                                "",
                                member_ids,
                                index_message=peer
                                if peer is not None and not peer.is_deleted
                                else None,
                            )
                        if message.sender_type == SenderType.USER:
                            if await ChatDraftOperations(session).stage_clear_for_message(
                                message, channel.organization_id
                            ):
                                events.append((
                                    message.sender_id,
                                    DRAFT_CHANGED,
                                    build_draft_changed_payload(
                                        channel.id,
                                        message.root_id,
                                        "",
                                        True,
                                        message.created_at,
                                        "",
                                    ),
                                ))
            await session.delete(row)
            await session.commit()
    DELIVERY_ATTEMPTS.labels(effect=effect, outcome="complete").inc()
    # Hints follow the durable checkpoint. Replaying deltas would double badges.
    try:
        if events:
            await publish_user_chat_events(events)
        if resource_types and channel_id is not None:
            await invalidate_cached_channel_resources(channel_id, resource_types)
    except Exception:
        logger.warning("Chat presentation hints unavailable for {}", message_id)
    await wake_chat_triggers(triggers)
    for event_id in notification_ids:
        try:
            async with asyncio.timeout(0.15):
                await enqueue_job(
                    DELIVER_NOTIFICATION_OUTBOX,
                    str(event_id),
                    _job_id=f"notification-outbox:{event_id}",
                )
        except Exception:
            logger.warning("Notification wakeup deferred for {}", event_id)


async def deliver_chat_message(ctx: dict[str, Any], message_id: str) -> None:
    mid = UUID(message_id)
    factory = cast(SessionFactory, ctx[SESSION_FACTORY_CTX_KEY])
    # Search outages must not postpone notification staging or agent admission.
    for effect in (
        ChatDeliveryEffect.AGENTS,
        ChatDeliveryEffect.NOTIFICATIONS,
        ChatDeliveryEffect.RESOURCES,
        ChatDeliveryEffect.INDEX,
    ):
        try:
            await _deliver_effect(ctx, mid, effect)
        except Exception as exc:
            async with factory() as session:
                row = await session.scalar(
                    select(ChatDelivery)
                    .where(
                        ChatDelivery.message_id == mid,
                        ChatDelivery.effect == effect,
                        ChatDelivery.status == ChatDeliveryStatus.PENDING,
                    )
                    .with_for_update()
                )
                if row is None:
                    continue
                row.attempts += 1
                row.last_error = type(exc).__name__[:100]
                row.dispatched_at = None
                row.available_at = datetime.now(UTC) + timedelta(seconds=min(3600, 2**row.attempts))
                if row.attempts >= MAX_DELIVERY_ATTEMPTS:
                    row.status = ChatDeliveryStatus.FAILED
                await session.commit()
            DELIVERY_ATTEMPTS.labels(effect=effect, outcome="failed").inc()
            logger.exception("Chat delivery failed: message={} effect={}", mid, effect)


async def recover_chat_deliveries(ctx: dict[str, Any]) -> None:
    factory = cast(SessionFactory, ctx[SESSION_FACTORY_CTX_KEY])
    now = datetime.now(UTC)
    async with factory() as session:
        rows = list(
            (
                await session.scalars(
                    select(ChatDelivery)
                    .where(
                        ChatDelivery.status == ChatDeliveryStatus.PENDING,
                        ChatDelivery.available_at <= now,
                        or_(
                            ChatDelivery.dispatched_at.is_(None),
                            ChatDelivery.dispatched_at < now - timedelta(seconds=30),
                        ),
                    )
                    .order_by(
                        ChatDelivery.available_at, ChatDelivery.message_id, ChatDelivery.effect
                    )
                    .limit(_RECOVERY_BATCH)
                    .with_for_update(skip_locked=True)
                )
            ).all()
        )
        mids = {row.message_id for row in rows}
        for row in rows:
            row.dispatched_at = now
        await session.commit()
    semaphore = asyncio.Semaphore(16)

    async def dispatch(mid: UUID) -> None:
        async with semaphore:
            try:
                # Different sweeps must not be suppressed by ARQ's retained result keys.
                async with asyncio.timeout(0.15):
                    await enqueue_job(
                        DELIVER_CHAT_MESSAGE,
                        str(mid),
                        _job_id=f"chat-delivery:{mid}:{now.isoformat()}",
                    )
            except Exception:
                logger.warning("Chat recovery enqueue deferred for {}", mid)

    await asyncio.gather(*(dispatch(mid) for mid in mids))
