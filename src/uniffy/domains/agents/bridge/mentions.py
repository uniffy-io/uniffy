"""Detect agent invocations on newly-sent chat messages."""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.types import SubjectType


@dataclass(frozen=True, slots=True)
class MentionDetectionResult:
    # `rule` is a stable token (`dm` / `mention` / `reply` / `thread`)
    # so analytics can group by trigger shape.
    agent_id: UUID
    rule: str


async def detect_agent_mentions(
    session: AsyncSession,
    message: ChatMessage,
    channel: ChatChannel,
) -> list[MentionDetectionResult]:
    """Return the agents that should fire in response to `message`.

    Only USER-authored messages trigger agents (loop guard). Duplicates
    across rules collapse to one invocation per agent.
    """
    if message.sender_type != SenderType.USER:
        return []

    # Joined against the agent row so a deleted agent produces no invocation at
    # all - no run, no typing indicator, no failed reply.
    member_rows = await session.execute(
        select(ChatChannelMember.subject_id)
        .join(Agent, Agent.id == ChatChannelMember.subject_id)
        .where(
            ChatChannelMember.channel_id == channel.id,
            ChatChannelMember.subject_type == SubjectType.AGENT,
            Agent.is_deleted == False,  # noqa: E712
        )
    )
    agent_members: set[UUID] = {r[0] for r in member_rows.all()}
    if not agent_members:
        return []

    matched: dict[UUID, str] = {}

    if channel.channel_type == ChannelType.DIRECT and len(agent_members) == 1:
        (only,) = tuple(agent_members)
        matched[only] = "dm"

    for mentioned in message.mentioned_agent_ids or ():
        if mentioned in agent_members and mentioned not in matched:
            matched[mentioned] = "mention"

    if message.reply_to_id is not None:
        parent = await session.execute(
            select(ChatMessage.sender_type, ChatMessage.sender_id).where(
                ChatMessage.id == message.reply_to_id
            )
        )
        parent_row = parent.one_or_none()
        if parent_row is not None:
            parent_sender_type, parent_sender_id = parent_row
            if (
                parent_sender_type == SenderType.AGENT
                and parent_sender_id in agent_members
                and parent_sender_id not in matched
            ):
                matched[parent_sender_id] = "reply"

    # Thread continuation: replying inside a thread whose root was authored
    # by an agent member triggers that agent so the conversation continues
    # without requiring a re-mention.
    if message.root_id is not None:
        root = await session.execute(
            select(ChatMessage.sender_type, ChatMessage.sender_id).where(
                ChatMessage.id == message.root_id
            )
        )
        root_row = root.one_or_none()
        if root_row is not None:
            root_sender_type, root_sender_id = root_row
            if (
                root_sender_type == SenderType.AGENT
                and root_sender_id in agent_members
                and root_sender_id not in matched
            ):
                matched[root_sender_id] = "thread"

    return [MentionDetectionResult(agent_id=aid, rule=rule) for aid, rule in matched.items()]
