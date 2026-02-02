"""Saved file filter operations for CRUD and listing.

This module handles all business logic for saved file filters including
create, read, update, delete, and list operations.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.files.saved_filter import SavedFileFilter


class SavedFilterOperations:
    """
    Saved file filter CRUD operations.

    Unlike content operations, saved filters don't use BaseContentOperations
    because they are not searchable content - they're user preferences.
    """

    def __init__(self, session: AsyncSession) -> None:
        """
        Initialize saved filter operations.

        Parameters
        ----------
        session : AsyncSession
            SQLAlchemy async session for database operations.

        """
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
        """
        Create a new saved filter.

        Parameters
        ----------
        user_id : UUID
            The user ID.
        organization_id : UUID
            The organization context.
        name : str
            Display name for the filter.
        criteria : dict[str, Any]
            Filter criteria.
        description : str | None
            Optional description.
        icon : dict[str, str] | None
            Optional icon (type + value).
        sort_by : str | None
            Default sort field.
        sort_order : str | None
            Default sort order (asc/desc).

        Returns
        -------
        SavedFileFilter
            The created filter.

        """
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
        """
        Get a saved filter by ID.

        Parameters
        ----------
        user_id : UUID
            The user ID (for permission check).
        organization_id : UUID
            The organization context.
        filter_id : UUID
            The filter ID.

        Returns
        -------
        SavedFileFilter
            The saved filter.

        Raises
        ------
        NotFoundError
            If filter not found.
        PermissionDeniedError
            If user doesn't own the filter (and it's not a preset).

        """
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
            raise NotFoundError("Saved filter not found")

        # Users can only access their own filters or presets
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
        """
        Update a saved filter.

        Parameters
        ----------
        user_id : UUID
            The user ID (for permission check).
        organization_id : UUID
            The organization context.
        filter_id : UUID
            The filter ID.
        name : str | None
            New name (if provided).
        description : str | None
            New description (if provided).
        icon : dict[str, str] | None
            New icon (if provided).
        criteria : dict[str, Any] | None
            New criteria (if provided).
        sort_by : str | None
            New sort field (if provided).
        sort_order : str | None
            New sort order (if provided).
        clear_icon : bool
            If True, remove the icon.

        Returns
        -------
        SavedFileFilter
            The updated filter.

        Raises
        ------
        NotFoundError
            If filter not found.
        PermissionDeniedError
            If user doesn't own the filter or filter is a preset.

        """
        saved_filter = await self.get_by_id(user_id, organization_id, filter_id)

        # Presets cannot be edited
        if saved_filter.is_preset:
            raise PermissionDeniedError("Preset filters cannot be edited")

        # Only owner can edit
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
        """
        Delete a saved filter.

        Parameters
        ----------
        user_id : UUID
            The user ID (for permission check).
        organization_id : UUID
            The organization context.
        filter_id : UUID
            The filter ID.

        Raises
        ------
        NotFoundError
            If filter not found.
        PermissionDeniedError
            If user doesn't own the filter or filter is a preset.

        """
        saved_filter = await self.get_by_id(user_id, organization_id, filter_id)

        # Presets cannot be deleted
        if saved_filter.is_preset:
            raise PermissionDeniedError("Preset filters cannot be deleted")

        # Only owner can delete
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
        """
        List saved filters for a user.

        Parameters
        ----------
        user_id : UUID
            The user ID.
        organization_id : UUID
            The organization context.
        include_presets : bool
            Whether to include system presets.

        Returns
        -------
        list[SavedFileFilter]
            List of saved filters (user's + presets if requested).

        """
        # Base query: user's filters in this org
        conditions = [
            SavedFileFilter.organization_id == organization_id,
            SavedFileFilter.user_id == user_id,
        ]

        if include_presets:
            # Include presets (which have is_preset=True)
            # Presets are org-scoped but not user-specific
            query = select(SavedFileFilter).where(
                and_(
                    SavedFileFilter.organization_id == organization_id,
                    (SavedFileFilter.user_id == user_id) | (SavedFileFilter.is_preset == True),  # noqa: E712
                )
            )
        else:
            query = select(SavedFileFilter).where(and_(*conditions))

        # Order: presets first, then by name
        query = query.order_by(
            SavedFileFilter.is_preset.desc(),
            SavedFileFilter.name.asc(),
        )

        result = await self.session.execute(query)
        return list(result.scalars().all())
