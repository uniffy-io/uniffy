from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.mentions import publish_mention_state
from uniffy.core.models.calls import Call
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.search import SearchIndexer
from uniffy.core.types import AccessMode, SubjectType
from uniffy.domains.calls.history import CallHistoryReader


async def stage_channel_history_refresh(session: AsyncSession, channel_id: UUID) -> None:
    await session.execute(
        update(Call).where(Call.channel_id == channel_id).values(search_pending=True)
    )


class CallProjection(CallHistoryReader):
    def __init__(self, session: AsyncSession, search_indexer: SearchIndexer) -> None:
        super().__init__(session)
        self.search_indexer = search_indexer

    async def project(self, call: Call) -> None:
        channel = await self.session.scalar(
            select(ChatChannel).where(
                ChatChannel.id == call.channel_id,
                ChatChannel.organization_id == call.organization_id,
            )
        )
        if channel is None or channel.is_deleted:
            await self.search_indexer.remove(call.urn)
            return
        public = channel.channel_type == ChannelType.PUBLIC
        members = (
            []
            if public
            else list(
                await self.session.scalars(
                    select(ChatChannelMember.user_id).where(
                        ChatChannelMember.channel_id == channel.id,
                        ChatChannelMember.subject_type == SubjectType.USER,
                        ChatChannelMember.user_id.is_not(None),
                    )
                )
            )
        )
        metadata = self._get_search_metadata(call)
        await self.search_indexer.index(
            urn=call.urn,
            organization_id=call.organization_id,
            title=call.title,
            entity_type=self.content_type.value,
            url_path=self._get_url_path(call),
            access_mode=(AccessMode.OPEN_TO_ORG if public else AccessMode.EXPLICIT_MEMBERS).value,
            baseline_role=None,
            owner_id=call.initiator_user_id,
            keywords=call.title,
            shared_user_ids=members,
            metadata=metadata,
        )
        await publish_mention_state(
            call.organization_id, call.urn, {"title": call.title, **metadata}
        )
