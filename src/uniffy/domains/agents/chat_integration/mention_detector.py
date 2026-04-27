"""Detect agent invocations on newly-sent chat messages.

The hot path: `send_message` post-commit calls `detect_agent_mentions(...)`.
It returns the list of (agent_id, rule) pairs that should fire. Phase 1
stops there (logs only). Phase 2 enqueues ARQ jobs into the runtime.

Detection rules (D8 in plan):
  1. DM — channel is DIRECT with the agent as member AND trigger is USER
  2. Mention — message content has `urn:uniffy:content:AGENT:<id>`
  3. Reply — reply_to_id points at an AGENT-authored message by `agent_id`
  4. Thread — message.root_id points at an AGENT-authored root message
     (agent must also be a channel member)

Binding-table-driven thread preferences (e.g. `respond_in_thread` off per
binding) are still Phase 5. The root-sender rule is always on for now
because the "agent started the thread; user replies in-thread" shape
should continue the conversation without requiring a re-mention.
"""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.types import SubjectType


@dataclass(frozen=True, slots=True)
class MentionDetectionResult:
    """A single matched agent invocation, keyed by rule.

    `rule` is a string token (`dm` / `mention` / `reply` / `thread`) kept
    stable so ARQ logs and analytics can group by trigger shape.
    """

    agent_id: UUID
    rule: str


async def detect_agent_mentions(
    session: AsyncSession,
    message: ChatMessage,
    channel: ChatChannel,
) -> list[MentionDetectionResult]:
    """Return the agents that should fire in response to `message`.

    Loop guard: only USER-authored messages trigger agents. Agent-authored
    messages never invoke other agents (answered by resolved decision #3).
    Duplicates across rules are collapsed -- one invocation per agent per
    trigger message, rule recorded for observability.
    """
    if message.sender_type != SenderType.USER:
        return []

    member_rows = await session.execute(
        select(ChatChannelMember.subject_id).where(
            ChatChannelMember.channel_id == channel.id,
            ChatChannelMember.subject_type == SubjectType.AGENT,
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

    # Thread continuation: replying inside a thread whose root message was
    # authored by an agent member triggers that agent. Plan calls this a
    # Phase 5 binding concern, but the shape here is identical to the reply
    # rule (just follows root_id instead of reply_to_id) and users expect it
    # to "just work" so the conversation continues in-thread without a
    # second mention.
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
