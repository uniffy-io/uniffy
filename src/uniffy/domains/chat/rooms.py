"""Chat-owned membership capability for rooms managed by another domain."""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.search import SearchIndexer
from uniffy.domains.chat.channels.operations import ChatChannelOperations
from uniffy.domains.chat.channels.state import StagedChatMembersAdd, StagedChatMembersRemove
from uniffy.domains.chat.lifecycle import ChannelCallLifecycle


@dataclass(frozen=True)
class StagedRoomMembershipSync:
    added: StagedChatMembersAdd | None
    removed: StagedChatMembersRemove | None


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
        staged = await self.stage_sync(
            owner_id,
            organization_id,
            channel_id,
            added_user_ids=added_user_ids,
            removed_user_ids=removed_user_ids,
        )
        if staged.added is None and staged.removed is None:
            return
        await self.operations.session.commit()
        await self.finish_sync_after_commit(staged)

    async def stage_sync(
        self,
        owner_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        *,
        added_user_ids: list[UUID],
        removed_user_ids: list[UUID],
    ) -> StagedRoomMembershipSync:
        added = (
            await self.operations.stage_members(
                owner_id,
                organization_id,
                channel_id,
                added_user_ids,
            )
            if added_user_ids
            else None
        )
        removed = (
            await self.operations.stage_members_remove(
                owner_id,
                organization_id,
                channel_id,
                removed_user_ids,
            )
            if removed_user_ids
            else None
        )
        return StagedRoomMembershipSync(added=added, removed=removed)

    async def finish_sync_after_commit(self, staged: StagedRoomMembershipSync) -> None:
        if staged.added is not None:
            await self.operations.finish_members_add_after_commit(staged.added)
        if staged.removed is not None:
            await self.operations.finish_members_remove_after_commit(staged.removed)
