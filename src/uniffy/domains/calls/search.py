from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.mentions import publish_mention_state
from uniffy.core.models.calls import Call
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.search import SearchIndexer
from uniffy.core.types import AccessMode
from uniffy.domains.calls.history import CallHistoryReader


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
        metadata = self._get_search_metadata(call)
        # Calls are excluded from discovery; reference reads authorize through the live channel.
        await self.search_indexer.index(
            urn=call.urn,
            organization_id=call.organization_id,
            title=call.title,
            entity_type=self.content_type.value,
            url_path=self._get_url_path(call),
            access_mode=AccessMode.OWNER_ONLY.value,
            baseline_role=None,
            owner_id=call.initiator_user_id,
            keywords=call.title,
            metadata=metadata,
        )
        await publish_mention_state(
            call.organization_id, call.urn, {"title": call.title, **metadata}
        )
