"""Claim queued invocations once and expose interrupted runs for inspection."""

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from uuid import UUID

from loguru import logger
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.database import SESSION_FACTORY_CTX_KEY, SessionFactory
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.jobs import enqueue_job_reconnecting
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.chat_trigger import AgentChatTrigger, ChatTriggerStatus
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.realtime.buffer import UPDATE_BUFFER_CTX_KEY
from uniffy.core.search import SEARCH_INDEXER_CTX_KEY
from uniffy.core.storage import OBJECT_STORAGE_CTX_KEY
from uniffy.core.types import SubjectType
from uniffy.domains.agents.bridge.jobs.contracts import DELIVER_CHAT_TRIGGER
from uniffy.domains.agents.bridge.operations import AgentChatBridge
from uniffy.domains.calls.lifecycle import CALL_LIFECYCLE_CTX_KEY
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.chat.features import is_chat_agents_enabled

logger = logger.bind(component="agents.bridge.jobs.triggers")
CHAT_TRIGGER_TIMEOUT_SECONDS = 900
_RECOVERY_BATCH = 100


async def _allowed(session: AsyncSession, trigger: AgentChatTrigger) -> bool:
    message = await session.get(ChatMessage, trigger.message_id)
    if (
        message is None
        or message.is_deleted
        or message.edited_at
        or message.sender_type != SenderType.USER
    ):
        return False
    channel = await session.get(ChatChannel, message.channel_id)
    agent = await session.get(Agent, trigger.agent_id)
    if channel is None or channel.is_deleted or channel.organization_id != trigger.organization_id:
        return False
    if agent is None or agent.is_deleted or agent.organization_id != trigger.organization_id:
        return False
    if not await is_chat_agents_enabled(session, trigger.organization_id):
        return False
    member = await session.scalar(
        select(ChatChannelMember.subject_id).where(
            ChatChannelMember.channel_id == channel.id,
            ChatChannelMember.subject_type == SubjectType.AGENT,
            ChatChannelMember.subject_id == trigger.agent_id,
        )
    )
    if member is None:
        return False
    try:
        await ChatAccessChecker(session).require_send(message.sender_id, channel)
    except NotFoundError, PermissionDeniedError, ValidationError:
        return False
    return True


async def deliver_chat_trigger(ctx: dict[str, Any], trigger_id: str) -> None:
    factory = cast(SessionFactory, ctx[SESSION_FACTORY_CTX_KEY])
    tid = UUID(trigger_id)
    async with factory() as session:
        trigger = await session.scalar(
            select(AgentChatTrigger)
            .where(
                AgentChatTrigger.id == tid,
                AgentChatTrigger.status == ChatTriggerStatus.PENDING,
            )
            .with_for_update(skip_locked=True)
        )
        if trigger is None:
            return
        if not await _allowed(session, trigger):
            trigger.status = ChatTriggerStatus.SKIPPED
            await session.commit()
            return
        message = await session.get(ChatMessage, trigger.message_id)
        channel_id = message.channel_id
        message_id, agent_id, rule, run_id = (
            trigger.message_id,
            trigger.agent_id,
            trigger.rule,
            trigger.run_id,
        )
        trigger.status = ChatTriggerStatus.RUNNING
        trigger.available_at = datetime.now(UTC) + timedelta(
            seconds=CHAT_TRIGGER_TIMEOUT_SECONDS + 60
        )
        await session.commit()
    try:
        async with factory() as session:
            await AgentChatBridge(session, factory).respond_to_chat_message(
                channel_id,
                message_id,
                agent_id,
                rule,
                storage=ctx[OBJECT_STORAGE_CTX_KEY],
                search_indexer=ctx[SEARCH_INDEXER_CTX_KEY],
                buffer=ctx[UPDATE_BUFFER_CTX_KEY],
                call_lifecycle=ctx[CALL_LIFECYCLE_CTX_KEY],
                run_id=run_id,
            )
    except Exception as exc:
        async with factory() as session:
            await session.execute(
                update(AgentChatTrigger)
                .where(
                    AgentChatTrigger.id == tid,
                    AgentChatTrigger.status == ChatTriggerStatus.RUNNING,
                )
                .values(status=ChatTriggerStatus.UNCERTAIN, last_error=type(exc).__name__[:100])
            )
            await session.commit()
        logger.exception("Chat agent invocation requires inspection: {}", tid)
        return
    async with factory() as session:
        await session.execute(
            update(AgentChatTrigger)
            .where(
                AgentChatTrigger.id == tid,
                AgentChatTrigger.status == ChatTriggerStatus.RUNNING,
            )
            .values(status=ChatTriggerStatus.COMPLETED)
        )
        await session.commit()


async def recover_chat_triggers(ctx: dict[str, Any]) -> None:
    factory = cast(SessionFactory, ctx[SESSION_FACTORY_CTX_KEY])
    now = datetime.now(UTC)
    async with factory() as session:
        rows = list(
            (
                await session.scalars(
                    select(AgentChatTrigger)
                    .where(
                        AgentChatTrigger.status.in_([
                            ChatTriggerStatus.PENDING,
                            ChatTriggerStatus.RUNNING,
                        ]),
                        AgentChatTrigger.available_at <= now,
                    )
                    .order_by(AgentChatTrigger.available_at, AgentChatTrigger.id)
                    .limit(_RECOVERY_BATCH)
                    .with_for_update(skip_locked=True)
                )
            ).all()
        )
        pending = []
        for row in rows:
            if row.status == ChatTriggerStatus.RUNNING:
                row.status = ChatTriggerStatus.UNCERTAIN
                row.last_error = "WorkerInterrupted"
                logger.error("Chat agent invocation interrupted: {}", row.id)
            else:
                row.available_at = now + timedelta(seconds=30)
                row.dispatches += 1
                pending.append((row.id, row.dispatches))
        await session.commit()
    for tid, generation in pending:
        try:
            async with asyncio.timeout(0.15):
                # The sweep runs on the core fleet, which opens the egress pool on demand.
                await enqueue_job_reconnecting(
                    DELIVER_CHAT_TRIGGER, str(tid), _job_id=f"chat-trigger:{tid}:{generation}"
                )
        except Exception:
            logger.warning("Chat agent recovery enqueue failed: {}", tid)
