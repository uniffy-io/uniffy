"""Saved-filter CRUD for the tags explorer.

is_preset=True rows are seeded by the system and are read-only for users.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.tags.saved_filter import SavedTagFilter


class SavedTagFilterOperations:
    """User-scoped preference rows; presets are org-scoped and shared via list_filters."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        name: str,
        criteria: dict[str, Any],
        description: str = "",
        icon: dict[str, str] | None = None,
        sort_by: str = "count",
        sort_order: str = "desc",
    ) -> SavedTagFilter:
        saved_filter = SavedTagFilter(
            user_id=user_id,
            organization_id=organization_id,
            name=name.strip(),
            description=description,
            icon=icon,
            criteria=criteria,
            sort_by=sort_by or "count",
            sort_order=sort_order or "desc",
            is_preset=False,
        )
        self.session.add(saved_filter)
        await self.session.commit()
        await self.session.refresh(saved_filter)
        return saved_filter

    async def get_by_id(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        filter_id: UUID,
    ) -> SavedTagFilter:
        result = await self.session.execute(
            select(SavedTagFilter).where(
                and_(
                    SavedTagFilter.id == filter_id,
                    SavedTagFilter.organization_id == organization_id,
                )
            )
        )
        saved_filter = result.scalars().first()
        if not saved_filter:
            raise NotFoundError("SavedTagFilter", str(filter_id))
        if saved_filter.user_id != user_id and not saved_filter.is_preset:
            raise PermissionDeniedError("Cannot access another user's saved filter")
        return saved_filter

    async def update(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        filter_id: UUID,
        name: str | None = None,
        description: str | None = None,
        icon: dict[str, str] | None = None,
        clear_icon: bool = False,
        criteria: dict[str, Any] | None = None,
        sort_by: str | None = None,
        sort_order: str | None = None,
    ) -> SavedTagFilter:
        saved_filter = await self.get_by_id(
            user_id=user_id,
            organization_id=organization_id,
            filter_id=filter_id,
        )

        if saved_filter.is_preset:
            raise PermissionDeniedError("Preset filters cannot be edited")
        if saved_filter.user_id != user_id:
            raise PermissionDeniedError("Cannot edit another user's saved filter")

        if name is not None:
            saved_filter.name = name.strip()
        if description is not None:
            saved_filter.description = description
        if clear_icon:
            saved_filter.icon = None
        elif icon is not None:
            saved_filter.icon = icon
        if criteria is not None:
            saved_filter.criteria = criteria
        if sort_by is not None:
            saved_filter.sort_by = sort_by
        if sort_order is not None:
            saved_filter.sort_order = sort_order

        saved_filter.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(saved_filter)
        return saved_filter

    async def delete(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        filter_id: UUID,
    ) -> None:
        saved_filter = await self.get_by_id(
            user_id=user_id,
            organization_id=organization_id,
            filter_id=filter_id,
        )
        if saved_filter.is_preset:
            raise PermissionDeniedError("Preset filters cannot be deleted")
        if saved_filter.user_id != user_id:
            raise PermissionDeniedError("Cannot delete another user's saved filter")
        await self.session.delete(saved_filter)
        await self.session.commit()

    async def list_filters(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        include_presets: bool = True,
    ) -> list[SavedTagFilter]:
        if include_presets:
            stmt = select(SavedTagFilter).where(
                and_(
                    SavedTagFilter.organization_id == organization_id,
                    (SavedTagFilter.user_id == user_id)
                    | (SavedTagFilter.is_preset == True),  # noqa: E712
                )
            )
        else:
            stmt = select(SavedTagFilter).where(
                and_(
                    SavedTagFilter.organization_id == organization_id,
                    SavedTagFilter.user_id == user_id,
                )
            )

        stmt = stmt.order_by(
            SavedTagFilter.is_preset.desc(),
            SavedTagFilter.name.asc(),
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
