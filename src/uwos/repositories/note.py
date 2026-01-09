"""Note repository for database operations."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uwos.models import Note


async def get_note_by_id(session: AsyncSession, note_id: UUID, organization_id: UUID) -> Note | None:
    """
    Get a note by ID within an organization.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    note_id : UUID
        Note ID to lookup.
    organization_id : UUID
        Organization ID for access control.

    Returns
    -------
    Note | None
        Note if found, None otherwise.

    """
    result = await session.execute(
        select(Note).where(and_(Note.id == note_id, Note.organization_id == organization_id))
    )
    return result.scalar_one_or_none()


async def get_note_by_slug(session: AsyncSession, slug: str, organization_id: UUID) -> Note | None:
    """
    Get a note by slug within an organization.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    slug : str
        Note slug to lookup.
    organization_id : UUID
        Organization ID for access control.

    Returns
    -------
    Note | None
        Note if found, None otherwise.

    """
    result = await session.execute(
        select(Note).where(and_(Note.slug == slug, Note.organization_id == organization_id))
    )
    return result.scalar_one_or_none()


async def create_note(
    session: AsyncSession,
    organization_id: UUID,
    owner_id: UUID,
    title: str,
    content: str,
    slug: str,
    visibility: Any | None = None,
    parent_id: UUID | None = None,
    tags: list[str] | None = None,
    metadata: dict | None = None,
) -> Note:
    """
    Create a new note.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    organization_id : UUID
        Organization ID.
    owner_id : UUID
        User ID of owner/creator.
    title : str
        Note title.
    content : str
        Note content (markdown).
    slug : str
        URL-friendly slug.
    visibility : VisibilityScope | None
        Visibility scope (defaults to PRIVATE).
    parent_id : UUID | None
        Optional parent note ID.
    tags : list[str] | None
        Optional list of tags.
    metadata : dict | None
        Optional metadata.

    Returns
    -------
    Note
        Created note.

    """
    from uwos.models.shared import VisibilityScope

    note = Note(
        organization_id=organization_id,
        owner_id=owner_id,
        visibility=visibility or VisibilityScope.PRIVATE,
        title=title,
        content=content,
        slug=slug,
        parent_id=parent_id,
        tags=tags,
        note_metadata=metadata,
    )
    session.add(note)
    await session.commit()
    await session.refresh(note)
    return note


async def update_note(
    session: AsyncSession,
    note: Note,
    title: str | None = None,
    content: str | None = None,
    slug: str | None = None,
    parent_id: UUID | None | str = None,
    tags: list[str] | None = None,
    metadata: dict | None = None,
) -> Note:
    """
    Update an existing note.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    note : Note
        Note to update.
    title : str | None
        Updated title.
    content : str | None
        Updated content.
    slug : str | None
        Updated slug.
    parent_id : UUID | None | str
        Updated parent ID (use "" to remove parent).
    tags : list[str] | None
        Updated tags.
    metadata : dict | None
        Updated metadata (merges with existing).

    Returns
    -------
    Note
        Updated note.

    """
    if title is not None:
        note.title = title
    if content is not None:
        note.content = content
    if slug is not None:
        note.slug = slug
    if parent_id == "":
        note.parent_id = None
    elif parent_id is not None:
        note.parent_id = parent_id
    if tags is not None:
        note.tags = tags
    if metadata is not None:
        if note.note_metadata:
            note.note_metadata.update(metadata)
        else:
            note.note_metadata = metadata

    note.version += 1
    note.updated_at = datetime.now(UTC)

    await session.commit()
    await session.refresh(note)
    return note


async def soft_delete_note(session: AsyncSession, note: Note) -> Note:
    """
    Soft delete a note.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    note : Note
        Note to delete.

    Returns
    -------
    Note
        Deleted note.

    """
    note.is_deleted = True
    note.deleted_at = datetime.now(UTC)
    note.updated_at = datetime.now(UTC)

    await session.commit()
    await session.refresh(note)
    return note


async def restore_note(session: AsyncSession, note: Note) -> Note:
    """
    Restore a soft-deleted note.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    note : Note
        Note to restore.

    Returns
    -------
    Note
        Restored note.

    """
    note.is_deleted = False
    note.deleted_at = None
    note.updated_at = datetime.now(UTC)

    await session.commit()
    await session.refresh(note)
    return note


async def permanent_delete_note(session: AsyncSession, note: Note) -> None:
    """
    Permanently delete a note from database.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    note : Note
        Note to permanently delete.

    Returns
    -------
    None

    """
    await session.delete(note)
    await session.commit()


async def toggle_pin(session: AsyncSession, note: Note, pinned: bool) -> Note:
    """
    Pin or unpin a note.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    note : Note
        Note to pin/unpin.
    pinned : bool
        Pin status.

    Returns
    -------
    Note
        Updated note.

    """
    note.is_pinned = pinned
    note.updated_at = datetime.now(UTC)

    await session.commit()
    await session.refresh(note)
    return note


async def list_notes(
    session: AsyncSession,
    organization_id: UUID,
    parent_id: UUID | None | str = None,
    tags: list[str] | None = None,
    include_deleted: bool = False,
    pinned_only: bool = False,
    page: int = 1,
    page_size: int = 50,
    sort_by: str = "updated_at",
    sort_order: str = "desc",
) -> tuple[list[Note], int]:
    """
    List notes with filters and pagination.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    organization_id : UUID
        Organization ID.
    parent_id : UUID | None | str
        Parent ID filter (use "root" for root notes only).
    tags : list[str] | None
        Tag filter.
    include_deleted : bool
        Whether to include deleted notes.
    pinned_only : bool
        Only return pinned notes.
    page : int
        Page number (1-indexed).
    page_size : int
        Page size.
    sort_by : str
        Field to sort by.
    sort_order : str
        Sort order (asc/desc).

    Returns
    -------
    tuple[list[Note], int]
        List of notes and total count.

    """
    # Build base query
    query = select(Note).where(Note.organization_id == organization_id)

    # Apply filters
    if not include_deleted:
        query = query.where(Note.is_deleted == False)  # noqa: E712

    if pinned_only:
        query = query.where(Note.is_pinned == True)  # noqa: E712

    if parent_id == "root":
        query = query.where(Note.parent_id.is_(None))
    elif parent_id is not None:
        query = query.where(Note.parent_id == parent_id)

    if tags:
        # Filter notes that contain all specified tags
        for tag in tags:
            query = query.where(Note.tags.contains([tag]))

    # Count total
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await session.execute(count_query)
    total_count = total_result.scalar_one()

    # Apply sorting
    sort_column = getattr(Note, sort_by, Note.updated_at)
    if sort_order.lower() == "asc":
        query = query.order_by(sort_column.asc())
    else:
        query = query.order_by(sort_column.desc())

    # Apply pagination
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    # Execute query
    result = await session.execute(query)
    notes = list(result.scalars().all())

    return notes, total_count


async def search_notes(
    session: AsyncSession,
    organization_id: UUID,
    query_text: str,
    tags: list[str] | None = None,
    include_deleted: bool = False,
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[Note], int]:
    """
    Search notes using full-text search.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    organization_id : UUID
        Organization ID.
    query_text : str
        Search query.
    tags : list[str] | None
        Tag filter.
    include_deleted : bool
        Whether to include deleted notes.
    page : int
        Page number (1-indexed).
    page_size : int
        Page size.

    Returns
    -------
    tuple[list[Note], int]
        List of notes and total count.

    """
    # Build base query with full-text search
    search_query = func.plainto_tsquery("english", query_text)

    query = select(Note).where(
        and_(
            Note.organization_id == organization_id,
            Note.content_search.op("@@")(search_query),
        )
    )

    # Apply filters
    if not include_deleted:
        query = query.where(Note.is_deleted == False)  # noqa: E712

    if tags:
        for tag in tags:
            query = query.where(Note.tags.contains([tag]))

    # Count total
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await session.execute(count_query)
    total_count = total_result.scalar_one()

    # Order by relevance
    query = query.order_by(func.ts_rank(Note.content_search, search_query).desc())

    # Apply pagination
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    # Execute query
    result = await session.execute(query)
    notes = list(result.scalars().all())

    return notes, total_count


async def get_backlinks(session: AsyncSession, note_id: UUID, organization_id: UUID) -> list[Note]:
    """
    Get notes that reference (link to) this note.

    This is a simplified implementation. For production, you'd want to:
    1. Parse content to extract [[wiki-links]]
    2. Store links in a separate table for performance
    3. Update links when content changes

    Parameters
    ----------
    session : AsyncSession
        Database session.
    note_id : UUID
        Target note ID.
    organization_id : UUID
        Organization ID.

    Returns
    -------
    list[Note]
        Notes that reference the target note.

    """
    # Get target note to find its slug
    target_note = await get_note_by_id(session, note_id, organization_id)
    if not target_note:
        return []

    # Search for notes containing the slug in wiki-link format
    # This is a basic implementation - production should use a link table
    search_pattern = f"%[[{target_note.slug}]]%"

    query = select(Note).where(
        and_(
            Note.organization_id == organization_id,
            Note.is_deleted == False,  # noqa: E712
            Note.id != note_id,  # Exclude self-references
            or_(
                Note.content.like(search_pattern),
                Note.content.like(f"%[[{target_note.title}]]%"),
            ),
        )
    )

    result = await session.execute(query)
    return list(result.scalars().all())
