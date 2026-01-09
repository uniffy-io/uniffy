"""Example usage of permission checking utilities.

This module demonstrates how to use the generic permission system
in your content services.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uwos.models.notes.note import Note
from uwos.models.shared import ContentType
from uwos.services.permissions import BaseContentService, ContentAccessQuery, PermissionChecker

# ==============================================================================
# Example 1: Using PermissionChecker directly
# ==============================================================================


async def example_direct_permission_check(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    note_id: UUID,
) -> None:
    """Example of using PermissionChecker directly."""
    # Get the note from database
    result = await session.execute(select(Note).where(Note.id == note_id))
    note = result.scalar_one()

    # Create permission checker
    checker = PermissionChecker(session)

    # Check various permissions
    can_view = await checker.can_access_content(
        user_id=user_id,
        organization_id=organization_id,
        content_type=ContentType.NOTE,
        content_id=note.id,
        content_owner_id=note.owner_id,
        content_visibility=note.visibility,
    )

    can_edit = await checker.can_edit_content(
        user_id=user_id,
        organization_id=organization_id,
        content_type=ContentType.NOTE,
        content_id=note.id,
        content_owner_id=note.owner_id,
        content_visibility=note.visibility,
    )

    can_delete = await checker.can_delete_content(
        user_id=user_id,
        organization_id=organization_id,
        content_type=ContentType.NOTE,
        content_id=note.id,
        content_owner_id=note.owner_id,
    )

    print(f"Can view: {can_view}, Can edit: {can_edit}, Can delete: {can_delete}")


# ==============================================================================
# Example 2: Using ContentAccessQuery for filtering
# ==============================================================================


async def example_query_accessible_notes(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
) -> list[Note]:
    """Example of filtering notes by accessibility."""
    # Create query builder
    query_builder = ContentAccessQuery(session)

    # Build the accessibility filter
    access_filter = query_builder.build_accessible_filter(
        user_id=user_id,
        organization_id=organization_id,
        content_type=ContentType.NOTE,
        content_id_column=Note.id,
        owner_id_column=Note.owner_id,
        visibility_column=Note.visibility,
    )

    # Use it in a query
    result = await session.execute(
        select(Note).where(Note.organization_id == organization_id).where(access_filter)
    )

    return list(result.scalars().all())


async def example_query_personal_notes(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
) -> list[Note]:
    """Example of getting user's personal notes."""
    query_builder = ContentAccessQuery(session)

    personal_filter = query_builder.build_personal_filter(
        user_id=user_id,
        owner_id_column=Note.owner_id,
        visibility_column=Note.visibility,
    )

    result = await session.execute(
        select(Note).where(Note.organization_id == organization_id).where(personal_filter)
    )

    return list(result.scalars().all())


async def example_query_group_notes(
    session: AsyncSession,
    group_id: UUID,
    organization_id: UUID,
) -> list[Note]:
    """Example of getting notes in a specific group."""
    query_builder = ContentAccessQuery(session)

    group_filter = query_builder.build_group_filter(
        group_id=group_id,
        organization_id=organization_id,
        content_type=ContentType.NOTE,
        content_id_column=Note.id,
        visibility_column=Note.visibility,
    )

    result = await session.execute(
        select(Note).where(Note.organization_id == organization_id).where(group_filter)
    )

    return list(result.scalars().all())


# ==============================================================================
# Example 3: Creating a custom service with BaseContentService
# ==============================================================================


class NoteService(BaseContentService[Note]):
    """Example Note service using BaseContentService."""

    def __init__(self, session: AsyncSession):
        """Initialize the note service."""
        super().__init__(
            session=session,
            content_type=ContentType.NOTE,
            content_id_attr="id",
            owner_id_attr="owner_id",
            visibility_attr="visibility",
        )

    async def get_accessible_notes(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> list[Note]:
        """
        Get all notes accessible to a user.

        Parameters
        ----------
        user_id : UUID
            User ID.
        organization_id : UUID
            Organization ID.

        Returns
        -------
        list[Note]
            List of accessible notes.

        """
        # Use the built-in filter from base service
        access_filter = self.get_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            model_class=Note,
        )

        result = await self.session.execute(
            select(Note).where(Note.organization_id == organization_id).where(access_filter)
        )

        return list(result.scalars().all())

    async def get_note_with_permission_check(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
    ) -> Note:
        """
        Get a note with automatic permission checking.

        Parameters
        ----------
        user_id : UUID
            User ID.
        organization_id : UUID
            Organization ID.
        note_id : UUID
            Note ID.

        Returns
        -------
        Note
            The note if accessible.

        Raises
        ------
        PermissionError
            If user doesn't have access.

        """
        result = await self.session.execute(select(Note).where(Note.id == note_id))
        note = result.scalar_one()

        # Use built-in permission check with automatic error raising
        await self.require_access(
            user_id=user_id,
            organization_id=organization_id,
            content=note,
            error_message=f"You don't have access to note {note_id}",
        )

        return note

    async def update_note_with_permission_check(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
        title: str | None = None,
        content: str | None = None,
    ) -> Note:
        """
        Update a note with automatic permission checking.

        Parameters
        ----------
        user_id : UUID
            User ID.
        organization_id : UUID
            Organization ID.
        note_id : UUID
            Note ID.
        title : str | None
            New title (optional).
        content : str | None
            New content (optional).

        Returns
        -------
        Note
            Updated note.

        Raises
        ------
        PermissionError
            If user doesn't have edit permission.

        """
        result = await self.session.execute(select(Note).where(Note.id == note_id))
        note = result.scalar_one()

        # Use built-in edit permission check
        await self.require_edit(
            user_id=user_id,
            organization_id=organization_id,
            content=note,
            error_message=f"You don't have permission to edit note {note_id}",
        )

        # Update the note
        if title is not None:
            note.title = title
        if content is not None:
            note.content = content

        await self.session.commit()
        await self.session.refresh(note)

        return note

    async def delete_note_with_permission_check(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
    ) -> bool:
        """
        Delete a note with automatic permission checking.

        Parameters
        ----------
        user_id : UUID
            User ID.
        organization_id : UUID
            Organization ID.
        note_id : UUID
            Note ID.

        Returns
        -------
        bool
            True if deleted successfully.

        Raises
        ------
        PermissionError
            If user doesn't have delete permission.

        """
        result = await self.session.execute(select(Note).where(Note.id == note_id))
        note = result.scalar_one()

        # Use built-in delete permission check
        await self.require_delete(
            user_id=user_id,
            organization_id=organization_id,
            content=note,
            error_message=f"You don't have permission to delete note {note_id}",
        )

        # Soft delete
        note.is_deleted = True
        await self.session.commit()

        return True

    async def get_personal_notes(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> list[Note]:
        """Get user's personal notes only."""
        personal_filter = self.get_personal_filter(
            user_id=user_id,
            model_class=Note,
        )

        result = await self.session.execute(
            select(Note).where(Note.organization_id == organization_id).where(personal_filter)
        )

        return list(result.scalars().all())

    async def get_group_notes(
        self,
        group_id: UUID,
        organization_id: UUID,
    ) -> list[Note]:
        """Get notes in a specific group."""
        group_filter = self.get_group_filter(
            group_id=group_id,
            organization_id=organization_id,
            model_class=Note,
        )

        result = await self.session.execute(
            select(Note).where(Note.organization_id == organization_id).where(group_filter)
        )

        return list(result.scalars().all())

    async def get_organization_notes(
        self,
        organization_id: UUID,
    ) -> list[Note]:
        """Get organization-wide notes."""
        org_filter = self.get_organization_filter(model_class=Note)

        result = await self.session.execute(
            select(Note).where(Note.organization_id == organization_id).where(org_filter)
        )

        return list(result.scalars().all())


# ==============================================================================
# Example 4: Usage in an RPC handler
# ==============================================================================


async def example_rpc_handler_get_note(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    note_id: UUID,
) -> Note:
    """
    Example RPC handler using NoteService.

    This is how you'd use it in a real ConnectRPC handler.
    """
    # Create service
    note_service = NoteService(session)

    # Get note with automatic permission checking
    # Raises PermissionError if user doesn't have access
    note = await note_service.get_note_with_permission_check(
        user_id=user_id,
        organization_id=organization_id,
        note_id=note_id,
    )

    return note


async def example_rpc_handler_list_notes(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    personal_only: bool = False,
    group_id: UUID | None = None,
) -> list[Note]:
    """
    Example RPC handler for listing notes with different filters.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    user_id : UUID
        User ID.
    organization_id : UUID
        Organization ID.
    personal_only : bool
        If True, only return personal notes.
    group_id : UUID | None
        If provided, only return notes from this group.

    Returns
    -------
    list[Note]
        Filtered notes.

    """
    note_service = NoteService(session)

    if personal_only:
        # Get only user's personal notes
        return await note_service.get_personal_notes(
            user_id=user_id,
            organization_id=organization_id,
        )
    elif group_id:
        # Get notes in specific group
        return await note_service.get_group_notes(
            group_id=group_id,
            organization_id=organization_id,
        )
    else:
        # Get all accessible notes (personal + groups + org)
        return await note_service.get_accessible_notes(
            user_id=user_id,
            organization_id=organization_id,
        )
