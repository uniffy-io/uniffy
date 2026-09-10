"""Stable public façade for agent runtime message execution."""

from collections.abc import AsyncGenerator
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.database import SessionFactory
from uniffy.core.models.agents.message import AgentMessage
from uniffy.core.search import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.domains.agents.providers.base import StreamEvent
from uniffy.domains.agents.runtime.destinations import RuntimeDestination
from uniffy.domains.agents.runtime.files import FileContext
from uniffy.domains.agents.runtime.send import MessageSender
from uniffy.domains.agents.runtime.stream import MessageStreamer
from uniffy.domains.chat.lifecycle import ChannelCallLifecycle


class RuntimeOperations:
    """Public runtime API composed from unary and streaming use-case owners."""

    def __init__(
        self,
        session: AsyncSession,
        storage: ObjectStorage,
        search_indexer: SearchIndexer,
        session_factory: SessionFactory,
        call_lifecycle: ChannelCallLifecycle,
    ) -> None:
        self._sender = MessageSender(
            session,
            storage,
            search_indexer,
            session_factory,
            call_lifecycle,
        )
        self._streamer = MessageStreamer(
            session,
            storage,
            search_indexer,
            session_factory,
            call_lifecycle,
        )

    async def send_message(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        session_id: UUID,
        content: str,
        files: list[FileContext] | None = None,
        user_timezone: str | None = None,
        invoked_skill_id: UUID | None = None,
    ) -> tuple[AgentMessage, AgentMessage, str]:
        return await self._sender.send(
            user_id=user_id,
            organization_id=organization_id,
            session_id=session_id,
            content=content,
            files=files,
            user_timezone=user_timezone,
            invoked_skill_id=invoked_skill_id,
        )

    def stream_rerun_from_message(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        message_id: UUID,
        user_timezone: str | None = None,
    ) -> AsyncGenerator[StreamEvent]:
        return self._streamer.rerun(
            user_id=user_id,
            organization_id=organization_id,
            message_id=message_id,
            user_timezone=user_timezone,
        )

    def stream_send_message(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        destination: RuntimeDestination,
        content: str,
        files: list[FileContext] | None = None,
        user_timezone: str | None = None,
        invoked_skill_id: UUID | None = None,
        rerun_anchor: AgentMessage | None = None,
        run_id: UUID | None = None,
        deadline_at: float | None = None,
    ) -> AsyncGenerator[StreamEvent]:
        return self._streamer.stream(
            user_id=user_id,
            organization_id=organization_id,
            destination=destination,
            content=content,
            files=files,
            user_timezone=user_timezone,
            invoked_skill_id=invoked_skill_id,
            rerun_anchor=rerun_anchor,
            run_id=run_id,
            deadline_at=deadline_at,
        )
