"""Chat channel category operations."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.chat.channel_category import ChatChannelCategory
from uniffy.domains.chat.access import ChatAccessChecker

logger = logger.bind(component="chat.categories.operations")


class ChatCategoryOperations:
    """Category CRUD; org admin or chat domain admin only."""

    def __init__(self, session: AsyncSession, access: ChatAccessChecker | None = None) -> None:
        self.session = session
        self.access = access or ChatAccessChecker(session)

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        name: str,
    ) -> ChatChannelCategory:
        await self._require_org_admin(user_id, organization_id)

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

        rename = name is not None and name != category.name
        if name is not None:
            category.name = name
        category.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(category)

        # Rename: each channel in this category carries the name in its search index.
        if rename:
            await self._refresh_channels_in_category(category_id)

        return category

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        category_id: UUID,
    ) -> None:
        """Delete a category; channels move to uncategorized."""
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

        # Snapshot ids before the UPDATE clears the category_id.
        affected_ids = await self._channel_ids_in_category(category_id)

        await self.session.execute(
            update(ChatChannel)
            .where(ChatChannel.category_id == category_id)
            .values(category_id=None)
        )

        await self.session.delete(category)
        await self.session.commit()

        await self._refresh_channels_by_id(affected_ids)

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

    async def reorder(
        self,
        user_id: UUID,
        organization_id: UUID,
        category_ids: list[UUID],
    ) -> list[ChatChannelCategory]:
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
        return await self.list_categories(user_id, organization_id)

    async def move_channel_to_category(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        category_id: UUID | None,
    ) -> None:
        """Move a channel to a category, or uncategorized when category_id is None."""
        await self._require_org_admin(user_id, organization_id)
        if category_id is not None:
            category = await self.session.execute(
                select(ChatChannelCategory.id).where(
                    ChatChannelCategory.id == category_id,
                    ChatChannelCategory.organization_id == organization_id,
                )
            )
            if category.scalar_one_or_none() is None:
                raise NotFoundError("category", category_id)

        channel = await self.session.execute(
            select(ChatChannel.id).where(
                ChatChannel.id == channel_id,
                ChatChannel.organization_id == organization_id,
                ChatChannel.is_deleted.is_(False),
            )
        )
        if channel.scalar_one_or_none() is None:
            raise NotFoundError("channel", channel_id)

        await self.session.execute(
            update(ChatChannel)
            .where(
                ChatChannel.id == channel_id,
                ChatChannel.organization_id == organization_id,
            )
            .values(category_id=category_id)
        )
        await self.session.commit()

        # Re-index so mention chips show the new category name.
        await self._refresh_channels_by_id([channel_id])

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

    async def _refresh_channels_in_category(self, category_id: UUID) -> None:
        ids = await self._channel_ids_in_category(category_id)
        await self._refresh_channels_by_id(ids)

    async def _refresh_channels_by_id(self, channel_ids: list[UUID]) -> None:
        # Lazy import: circular dep between category and channel operations.
        if not channel_ids:
            return
        from uniffy.domains.chat.channels.operations import ChatChannelOperations

        channel_ops = ChatChannelOperations(self.session, self.access)
        result = await self.session.execute(
            select(ChatChannel).where(ChatChannel.id.in_(channel_ids))
        )
        for channel in result.scalars().all():
            try:
                await channel_ops._refresh_channel_live_state(channel)
            except Exception:
                logger.warning(f"Failed to refresh live state for channel {channel.id}")
