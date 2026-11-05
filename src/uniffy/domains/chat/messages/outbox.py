"""Commit delivery intent before attempting a bounded queue wakeup."""

import asyncio
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import bindparam, insert, lambda_stmt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.lambdas import StatementLambdaElement

from uniffy.core.jobs import enqueue_job
from uniffy.core.models.chat.delivery import ChatDelivery, ChatDeliveryEffect, ChatDeliveryStatus
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.domains.chat.jobs.contracts import DELIVER_CHAT_MESSAGE

logger = logger.bind(component="chat.messages.outbox")


def _insert_for(sender_type: SenderType) -> StatementLambdaElement:
    effects = [ChatDeliveryEffect.NOTIFICATIONS, ChatDeliveryEffect.RESOURCES]
    if sender_type != SenderType.SYSTEM:
        effects.append(ChatDeliveryEffect.INDEX)
    if sender_type == SenderType.USER:
        effects.append(ChatDeliveryEffect.AGENTS)
    statement = insert(ChatDelivery.__table__).values([
        {
            "message_id": bindparam("delivery_message_id"),
            "organization_id": bindparam("delivery_org_id"),
            "effect": effect,
            "status": ChatDeliveryStatus.PENDING,
            "attempts": 0,
            "created_at": bindparam("delivery_now"),
            "available_at": bindparam("delivery_now"),
        }
        for effect in effects
    ])

    return lambda_stmt(lambda: statement, track_on=[sender_type])


_DELIVERY_INSERTS = {sender_type: _insert_for(sender_type) for sender_type in SenderType}


async def stage_message_delivery(
    session: AsyncSession, message: ChatMessage, organization_id: UUID
) -> None:
    await session.execute(
        _DELIVERY_INSERTS[message.sender_type],
        {
            "delivery_message_id": message.id,
            "delivery_org_id": organization_id,
            "delivery_now": datetime.now(UTC),
        },
    )


async def wake_message_delivery(message_id: UUID) -> None:
    try:
        async with asyncio.timeout(0.15):
            await enqueue_job(DELIVER_CHAT_MESSAGE, str(message_id))
    except Exception:
        logger.warning("Chat delivery wakeup deferred to recovery for message {}", message_id)
