"""Calendar operations."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.membership import get_active_membership
from uniffy.core.errors import (
    NotFoundError,
    PermissionDeniedError,
)
from uniffy.core.models.calendar.category import Category
from uniffy.domains.scheduling.calendar import queries

logger = logger.bind(component="scheduling.calendar.categories.operations")


class CategoryOperations:
    """Category CRUD (no permission system; org-wide)."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _verify_org_membership(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> None:
        if await get_active_membership(self.session, user_id, organization_id) is None:
            raise PermissionDeniedError("access", "organization")

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        name: str,
        color: str,
        icon: str | None = None,
    ) -> Category:
        await self._verify_org_membership(user_id, organization_id)

        result = await self.session.execute(
            select(func.max(Category.sort_order)).where(Category.organization_id == organization_id)
        )
        max_order = result.scalar() or 0

        category = Category(
            organization_id=organization_id,
            name=name,
            color=color,
            icon=icon,
            is_default=False,
            sort_order=max_order + 1,
        )
        self.session.add(category)
        await self.session.commit()
        await self.session.refresh(category)
        return category

    async def get_by_id(
        self,
        user_id: UUID,
        category_id: UUID,
        organization_id: UUID,
    ) -> Category:
        await self._verify_org_membership(user_id, organization_id)

        result = await self.session.execute(
            select(Category).where(
                and_(
                    Category.id == category_id,
                    Category.organization_id == organization_id,
                )
            )
        )
        category = result.scalar_one_or_none()
        if not category:
            raise NotFoundError("Category", category_id)
        return category

    async def update(
        self,
        user_id: UUID,
        category_id: UUID,
        organization_id: UUID,
        name: str | None = None,
        color: str | None = None,
        icon: str | None = None,
        sort_order: int | None = None,
    ) -> Category:
        await self._verify_org_membership(user_id, organization_id)

        category = await self.get_by_id(user_id, category_id, organization_id)

        if name is not None:
            category.name = name
        if color is not None:
            category.color = color
        if icon is not None:
            category.icon = icon
        if sort_order is not None:
            category.sort_order = sort_order

        category.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(category)
        return category

    async def delete(
        self,
        user_id: UUID,
        category_id: UUID,
        organization_id: UUID,
    ) -> bool:
        """Delete a category; default categories cannot be deleted."""
        await self._verify_org_membership(user_id, organization_id)

        category = await self.get_by_id(user_id, category_id, organization_id)

        if category.is_default:
            raise PermissionDeniedError("delete", "default category")

        await self.session.delete(category)
        await self.session.commit()
        return True

    async def list_categories(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> list[Category]:
        await self._verify_org_membership(user_id, organization_id)
        return await queries.get_categories(self.session, organization_id)

    async def ensure_defaults(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> list[Category]:
        """Ensure the org has default categories."""
        await self._verify_org_membership(user_id, organization_id)
        return await queries.ensure_default_categories(self.session, organization_id)
