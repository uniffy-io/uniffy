"""Read and access operations for chat categories."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.chat.channel_category import ChatChannelCategory
from uniffy.domains.chat.access import ChatAccessChecker


class ChatCategoryReader:
    def __init__(self, session: AsyncSession, access: ChatAccessChecker | None = None) -> None:
        self.session = session
        self.access = access or ChatAccessChecker(session)

    async def list_categories(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> list[ChatChannelCategory]:
        await self._require_org_member(user_id, organization_id)
        result = await self.session.execute(
            select(ChatChannelCategory)
            .where(ChatChannelCategory.organization_id == organization_id)
            .order_by(ChatChannelCategory.position)
        )
        return list(result.scalars().all())

    async def _require_org_member(self, user_id: UUID, organization_id: UUID) -> None:
        await self.access.require_org_member(user_id, organization_id)

    async def _require_org_admin(self, user_id: UUID, organization_id: UUID) -> None:
        if await self.access.is_org_admin(user_id, organization_id):
            return
        if await self.access.is_chat_domain_admin(user_id, organization_id):
            return
        raise PermissionDeniedError("admin", "Requires org admin or chat domain admin")

    async def _channel_ids_in_category(self, category_id: UUID) -> list[UUID]:
        result = await self.session.execute(
            select(ChatChannel.id).where(ChatChannel.category_id == category_id)
        )
        return list(result.scalars().all())
