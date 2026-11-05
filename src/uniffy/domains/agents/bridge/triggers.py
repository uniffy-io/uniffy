"""Durable admission for automatic chat invocations."""

import asyncio
from uuid import UUID

from loguru import logger
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.jobs import enqueue_job
from uniffy.core.models.agents.chat_trigger import AgentChatTrigger
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.domains.agents.bridge.jobs.contracts import DELIVER_CHAT_TRIGGER
from uniffy.domains.agents.bridge.mentions import detect_agent_mentions
from uniffy.domains.chat.features import is_chat_agents_enabled

logger = logger.bind(component="agents.bridge.triggers")


async def stage_chat_triggers(
    session: AsyncSession, message: ChatMessage, channel: ChatChannel
) -> list[UUID]:
    if message.sender_type != SenderType.USER or message.edited_at or message.is_deleted:
        return []
    if not await is_chat_agents_enabled(session, channel.organization_id):
        return []
    matches = await detect_agent_mentions(session, message, channel)
    if not matches:
        return []
    rows = [
        AgentChatTrigger(
            organization_id=channel.organization_id,
            message_id=message.id,
            agent_id=match.agent_id,
            rule=match.rule,
        ).model_dump()
        for match in matches
    ]
    return list(
        (
            await session.scalars(
                insert(AgentChatTrigger)
                .values(rows)
                .on_conflict_do_nothing(
                    constraint="uq_agents_chat_trigger",
                )
                .returning(AgentChatTrigger.id)
            )
        ).all()
    )


async def wake_chat_triggers(ids: list[UUID]) -> None:
    for trigger_id in ids:
        try:
            async with asyncio.timeout(0.15):
                await enqueue_job(DELIVER_CHAT_TRIGGER, str(trigger_id))
        except Exception:
            logger.warning("Agent trigger wakeup deferred for {}", trigger_id)
