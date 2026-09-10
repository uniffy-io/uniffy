"""Persist draft cards with their lifecycle and publish committed presentation changes."""

from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.agents.skill_draft import AgentSkillDraft
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.chat.message import ChatMessage, ChatMessageMetadataKind, SenderType
from uniffy.core.models.chat.thread import ChatThreadStats
from uniffy.core.types import SubjectType
from uniffy.domains.chat import agents as chat_events

logger = logger.bind(component="agents.skills.cards")


async def stage_draft_card(session: AsyncSession, draft: AgentSkillDraft) -> None:
    if draft.channel_id is None or draft.proposed_by_agent_id is None:
        return
    message = None
    if draft.origin_chat_message_id is not None:
        message = (
            await session.execute(
                select(ChatMessage).where(
                    ChatMessage.id == draft.origin_chat_message_id,
                    ChatMessage.channel_id == draft.channel_id,
                    ChatMessage.is_deleted.is_(False),
                )
            )
        ).scalar_one_or_none()
        if message is None:
            return

    title = draft.display_name or draft.name or "Skill draft"
    metadata = {
        "kind": ChatMessageMetadataKind.SKILL_DRAFT,
        "agent_id": str(draft.proposed_by_agent_id),
        "draft_id": str(draft.id),
        "draft_kind": draft.kind,
        "draft_name": draft.name or "",
        "draft_display_name": title,
        "draft_description": (draft.description or "")[:500],
        "draft_status": draft.status,
        "draft_error": draft.generation_error or "",
        "draft_attempt": str(draft.generation_attempt),
        "actor_user_id": str(draft.owner_id),
    }
    if message is None:
        message = ChatMessage(
            channel_id=draft.channel_id,
            sender_id=draft.proposed_by_agent_id,
            sender_type=SenderType.AGENT,
            root_id=draft.thread_root_id,
            reply_to_id=UUID(draft.evidence_message_ids[-1]),
            content=title,
            message_metadata=metadata,
        )
        session.add(message)
        draft.origin_chat_message_id = message.id
        await chat_events.bump_channel_message_stats(
            session, draft.channel_id, at=message.created_at, is_root=draft.thread_root_id is None
        )
        if draft.thread_root_id is not None:
            await chat_events.record_thread_reply(
                session,
                root_message_id=draft.thread_root_id,
                channel_id=draft.channel_id,
                sender_type=SenderType.AGENT,
                sender_id=draft.proposed_by_agent_id,
                at=message.created_at,
            )
    else:
        message.content = title
        message.message_metadata = {**(message.message_metadata or {}), **metadata}


async def publish_draft_card(
    session: AsyncSession, draft: AgentSkillDraft, *, created: bool = False
) -> None:
    if draft.channel_id is None or draft.origin_chat_message_id is None:
        return
    try:
        message = await session.get(ChatMessage, draft.origin_chat_message_id)
        if message is None or message.is_deleted:
            return
        members = list(
            (
                await session.execute(
                    select(ChatChannelMember.subject_id).where(
                        ChatChannelMember.channel_id == draft.channel_id,
                        ChatChannelMember.subject_type == SubjectType.USER,
                    )
                )
            ).scalars()
        )
        await chat_events.publish_channel_event_to_members(
            members,
            chat_events.MESSAGE_CREATED if created else chat_events.MESSAGE_UPDATED,
            chat_events.build_message_payload(
                message_id=message.id,
                channel_id=message.channel_id,
                sender_id=message.sender_id,
                sender_type=SenderType.AGENT,
                content=message.content,
                root_id=message.root_id,
                created_at=message.created_at,
                metadata=message.message_metadata,
                reply_to_id=message.reply_to_id,
            ),
            channel_id=message.channel_id,
        )
        if created and message.root_id:
            stats = await session.get(ChatThreadStats, message.root_id)
            if stats:
                await chat_events.publish_channel_event_to_members(
                    members,
                    chat_events.THREAD_UPDATED,
                    chat_events.build_thread_updated_payload(
                        root_message_id=message.root_id,
                        reply_count=stats.reply_count,
                        last_reply_at=stats.last_reply_at,
                        latest_participant_id=message.sender_id,
                    ),
                    channel_id=message.channel_id,
                )
    except Exception:
        logger.opt(exception=True).warning("Draft card fanout failed", draft_id=str(draft.id))
