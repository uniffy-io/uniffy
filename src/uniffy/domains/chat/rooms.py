"""Chat-owned membership capability for rooms managed by another domain."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.search import SearchIndexer
from uniffy.domains.chat.channels.operations import ChatChannelOperations
from uniffy.domains.chat.lifecycle import ChannelCallLifecycle


class RoomMembership:
    def __init__(
        self,
        session: AsyncSession,
        search_indexer: SearchIndexer,
        call_lifecycle: ChannelCallLifecycle,
    ) -> None:
        self.operations = ChatChannelOperations(
            session,
            search_indexer=search_indexer,
            call_lifecycle=call_lifecycle,
        )

    async def sync(
        self,
        owner_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        *,
        added_user_ids: list[UUID],
        removed_user_ids: list[UUID],
    ) -> None:
        if added_user_ids:
            await self.operations.add_members(
                owner_id,
                organization_id,
                channel_id,
                added_user_ids,
            )
        if removed_user_ids:
            await self.operations.remove_members(
                owner_id,
                organization_id,
                channel_id,
                removed_user_ids,
            )
