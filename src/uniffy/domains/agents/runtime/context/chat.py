"""Chat-channel and thread context construction."""

from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.models.chat.message import SenderType as ChatSenderType
from uniffy.core.types import SubjectType
from uniffy.domains.agents.runtime.destinations import ChatDestination, RuntimeDestination
from uniffy.domains.agents.runtime.prompt import (
    build_chat_context_section,
    build_thread_turn_note,
)
from uniffy.domains.chat.agents import SenderResolver

logger = logger.bind(component="agents.runtime.context.chat")

THREAD_ROOT_PREVIEW_CHARS = 160


class ChatContextBuilder:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def build_channel(
        self,
        *,
        destination: ChatDestination,
        trigger_user_name: str,
    ) -> str | None:
        try:
            channel = await self._session.get(ChatChannel, destination.channel_id)
            if channel is None:
                return None

            member_rows = (
                (
                    await self._session.execute(
                        select(ChatChannelMember).where(
                            ChatChannelMember.channel_id == destination.channel_id,
                        )
                    )
                )
                .scalars()
                .all()
            )

            resolver = SenderResolver(self._session)
            refs: list[tuple[ChatSenderType, UUID]] = []
            for member in member_rows:
                if member.subject_type == SubjectType.USER:
                    refs.append((ChatSenderType.USER, member.subject_id))
                elif member.subject_type == SubjectType.AGENT:
                    refs.append((ChatSenderType.AGENT, member.subject_id))
            resolved = await resolver.resolve_many(refs) if refs else {}

            user_names: list[str] = []
            agent_names: list[str] = []
            for member in member_rows:
                info = resolved.get(member.subject_id)
                if not info:
                    continue
                if member.subject_type == SubjectType.USER:
                    user_names.append(info.display_name)
                elif member.subject_type == SubjectType.AGENT:
                    if info.id == destination.agent_id:
                        continue
                    agent_names.append(info.display_name)

            channel_type = (
                channel.channel_type.value
                if hasattr(channel.channel_type, "value")
                else str(channel.channel_type)
            )
            return build_chat_context_section(
                channel_type=channel_type,
                channel_name=channel.name or "",
                channel_description=channel.description or None,
                participant_users=user_names,
                participant_agents=agent_names,
                trigger_user_name=trigger_user_name or "the requester",
                trigger_rule=destination.trigger_rule,
            )
        except Exception:
            logger.opt(exception=True).warning(
                "Failed to build chat_context block; continuing without it"
            )
            return None

    async def build_thread(self, destination: RuntimeDestination) -> str | None:
        if not isinstance(destination, ChatDestination) or destination.thread_root_id is None:
            return None

        root = await self._session.get(ChatMessage, destination.thread_root_id)
        if root is None:
            return None

        info = await SenderResolver(self._session).resolve_one(root.sender_type, root.sender_id)
        author = info.display_name if info else None

        text = " ".join((root.content or "").split())
        if len(text) > THREAD_ROOT_PREVIEW_CHARS:
            text = text[:THREAD_ROOT_PREVIEW_CHARS].rstrip() + "..."
        return build_thread_turn_note(author, text or None)
