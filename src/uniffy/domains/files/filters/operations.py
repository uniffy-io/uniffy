"""Saved file filter CRUD."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.files.saved_filter import SavedFileFilter


class SavedFilterOperations:
    """Saved file filter CRUD; presets cannot be edited or deleted."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        name: str,
        criteria: dict[str, Any],
        description: str | None = None,
        icon: dict[str, str] | None = None,
        sort_by: str | None = None,
        sort_order: str | None = None,
    ) -> SavedFileFilter:
        saved_filter = SavedFileFilter(
            user_id=user_id,
            organization_id=organization_id,
            name=name,
            description=description,
            icon=icon,
            criteria=criteria,
            is_preset=False,
            sort_by=sort_by,
            sort_order=sort_order,
        )
        self.session.add(saved_filter)
        await self.session.commit()
        await self.session.refresh(saved_filter)
        return saved_filter

    async def get_by_id(
        self,
        user_id: UUID,
        organization_id: UUID,
        filter_id: UUID,
    ) -> SavedFileFilter:
        """Users can read own filters or presets."""
        result = await self.session.execute(
            select(SavedFileFilter).where(
                and_(
                    SavedFileFilter.id == filter_id,
                    SavedFileFilter.organization_id == organization_id,
                )
            )
        )
        saved_filter = result.scalars().first()

        if not saved_filter:
            raise NotFoundError("Saved filter", filter_id)

        if saved_filter.user_id != user_id and not saved_filter.is_preset:
            raise PermissionDeniedError("You don't have access to this filter")

        return saved_filter

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        filter_id: UUID,
        name: str | None = None,
        description: str | None = None,
        icon: dict[str, str] | None = None,
        criteria: dict[str, Any] | None = None,
        sort_by: str | None = None,
        sort_order: str | None = None,
        clear_icon: bool = False,
    ) -> SavedFileFilter:
        """Owner-only update; non-None kwargs apply, clear_icon removes the icon."""
        saved_filter = await self.get_by_id(user_id, organization_id, filter_id)

        if saved_filter.is_preset:
            raise PermissionDeniedError("Preset filters cannot be edited")

        if saved_filter.user_id != user_id:
            raise PermissionDeniedError("You don't have permission to edit this filter")

        if name is not None:
            saved_filter.name = name
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
        user_id: UUID,
        organization_id: UUID,
        filter_id: UUID,
    ) -> None:
        """Owner-only delete; presets cannot be removed."""
        saved_filter = await self.get_by_id(user_id, organization_id, filter_id)

        if saved_filter.is_preset:
            raise PermissionDeniedError("Preset filters cannot be deleted")

        if saved_filter.user_id != user_id:
            raise PermissionDeniedError("You don't have permission to delete this filter")

        await self.session.delete(saved_filter)
        await self.session.commit()

    async def list_filters(
        self,
        user_id: UUID,
        organization_id: UUID,
        include_presets: bool = True,
    ) -> list[SavedFileFilter]:
        """User's filters in the org, optionally plus org presets."""
        conditions = [
            SavedFileFilter.organization_id == organization_id,
            SavedFileFilter.user_id == user_id,
        ]

        if include_presets:
            query = select(SavedFileFilter).where(
                and_(
                    SavedFileFilter.organization_id == organization_id,
                    (SavedFileFilter.user_id == user_id) | (SavedFileFilter.is_preset == True),  # noqa: E712
                )
            )
        else:
            query = select(SavedFileFilter).where(and_(*conditions))

        # Presets first, then by name.
        query = query.order_by(
            SavedFileFilter.is_preset.desc(),
            SavedFileFilter.name.asc(),
        )

        result = await self.session.execute(query)
        return list(result.scalars().all())
