"""Chat channel category operations."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.chat.channel_category import ChatChannelCategory
from uniffy.domains.chat.access import ChatAccessChecker


class ChatCategoryOperations:
    """Category CRUD operations. Org admin only."""

    def __init__(self, session: AsyncSession, access: ChatAccessChecker | None = None) -> None:
        self.session = session
        self.access = access or ChatAccessChecker(session)

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        name: str,
    ) -> ChatChannelCategory:
        """Create a new category."""
        await self._require_org_admin(user_id, organization_id)

        # Get next position
        result = await self.session.execute(
            select(ChatChannelCategory.position)
            .where(ChatChannelCategory.organization_id == organization_id)
            .order_by(ChatChannelCategory.position.desc())
            .limit(1)
        )
        max_pos = result.scalar_one_or_none() or 0

        category = ChatChannelCategory(
            organization_id=organization_id,
            name=name,
            position=max_pos + 1,
            created_by=user_id,
        )
        self.session.add(category)
        await self.session.commit()
        await self.session.refresh(category)
        return category

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        category_id: UUID,
        name: str | None = None,
    ) -> ChatChannelCategory:
        """Update a category."""
        await self._require_org_admin(user_id, organization_id)

        result = await self.session.execute(
            select(ChatChannelCategory).where(
                ChatChannelCategory.id == category_id,
                ChatChannelCategory.organization_id == organization_id,
            )
        )
        category = result.scalar_one_or_none()
        if not category:
            raise NotFoundError("category", category_id)

        if name is not None:
            category.name = name
        category.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(category)
        return category

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        category_id: UUID,
    ) -> None:
        """Delete a category. Channels move to uncategorized."""
        await self._require_org_admin(user_id, organization_id)

        result = await self.session.execute(
            select(ChatChannelCategory).where(
                ChatChannelCategory.id == category_id,
                ChatChannelCategory.organization_id == organization_id,
            )
        )
        category = result.scalar_one_or_none()
        if not category:
            raise NotFoundError("category", category_id)

        # Move channels to uncategorized
        await self.session.execute(
            update(ChatChannel)
            .where(ChatChannel.category_id == category_id)
            .values(category_id=None)
        )

        await self.session.delete(category)
        await self.session.commit()

    async def list_categories(
        self,
        organization_id: UUID,
    ) -> list[ChatChannelCategory]:
        """List all categories for an org."""
        result = await self.session.execute(
            select(ChatChannelCategory)
            .where(ChatChannelCategory.organization_id == organization_id)
            .order_by(ChatChannelCategory.position)
        )
        return list(result.scalars().all())

    async def reorder(
        self,
        user_id: UUID,
        organization_id: UUID,
        category_ids: list[UUID],
    ) -> list[ChatChannelCategory]:
        """Reorder categories by updating positions."""
        await self._require_org_admin(user_id, organization_id)

        for i, cid in enumerate(category_ids):
            await self.session.execute(
                update(ChatChannelCategory)
                .where(
                    ChatChannelCategory.id == cid,
                    ChatChannelCategory.organization_id == organization_id,
                )
                .values(position=i)
            )

        await self.session.commit()
        return await self.list_categories(organization_id)

    async def move_channel_to_category(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        category_id: UUID | None,
    ) -> None:
        """Move a channel to a category (or uncategorized)."""
        await self.session.execute(
            update(ChatChannel)
            .where(
                ChatChannel.id == channel_id,
                ChatChannel.organization_id == organization_id,
            )
            .values(category_id=category_id)
        )
        await self.session.commit()

    async def _require_org_admin(self, user_id: UUID, organization_id: UUID) -> None:
        """Verify user is org admin/owner or chat domain admin."""
        if await self.access.is_org_admin(user_id, organization_id):
            return
        if await self.access.is_chat_domain_admin(user_id, organization_id):
            return
        raise PermissionDeniedError("admin", "Requires org admin or chat domain admin")
