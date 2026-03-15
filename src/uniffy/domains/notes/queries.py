"""Note-specific database queries."""

import re
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.notes.note import Note
from uniffy.core.models.shared import NodeType
from uniffy.core.types import slugify  # noqa: F401 - re-exported, used via queries.slugify

# Regex pattern for inline tags in markdown: [[[tag|tagname]]]
# Tags are stored with the "tag|" prefix to distinguish from URN mentions
INLINE_TAG_PATTERN = re.compile(r"\[\[\[tag\|([^\]]+)\]\]\]")


def extract_inline_tags_from_content(content: str) -> list[str]:
    """
    Extract all unique inline tags from markdown content.

    Parses the [[[tag|tagname]]] pattern used by the editor's tag plugin
    and returns a deduplicated, sorted list of tag names.

    Parameters
    ----------
    content : str
        Markdown content to parse.

    Returns
    -------
    list[str]
        Unique tag names found in the content (lowercase, sorted).

    """
    if not content:
        return []

    tags: set[str] = set()
    for match in INLINE_TAG_PATTERN.finditer(content):
        tag_name = match.group(1).strip().lower()
        if tag_name:
            tags.add(tag_name)

    return sorted(tags)


def extract_inline_tags_from_canvas(canvas_data: dict | str) -> list[str]:
    """
    Extract all unique inline tags from canvas data.

    Parses the canvas structure, iterates over text nodes, and
    calls ``extract_inline_tags_from_content()`` on each node's content.

    Parameters
    ----------
    canvas_data : dict | str
        Canvas state as a dict (from JSONB) or JSON string (legacy).

    Returns
    -------
    list[str]
        Unique tag names found in the canvas (lowercase, sorted).

    """
    if not canvas_data:
        return []

    # Accept both dict (from JSONB column) and str (legacy)
    if isinstance(canvas_data, str):
        import json as _json

        try:
            data = _json.loads(canvas_data)
        except ValueError, TypeError:
            return []
    else:
        data = canvas_data

    nodes = data.get("nodes", [])
    tags: set[str] = set()

    for node in nodes:
        node_data = node.get("data", {})
        if node_data.get("type") == "text":
            content = node_data.get("content", "")
            if content:
                for tag in extract_inline_tags_from_content(content):
                    tags.add(tag)

    return sorted(tags)


async def get_by_slug(
    session: AsyncSession,
    slug: str,
    organization_id: UUID,
) -> Note | None:
    """
    Get a note by slug within an organization.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    slug : str
        Note slug.
    organization_id : UUID
        Organization ID.

    Returns
    -------
    Note | None
        Note if found, None otherwise.

    """
    result = await session.execute(
        select(Note).where(
            and_(
                Note.slug == slug,
                Note.organization_id == organization_id,
            )
        )
    )
    return result.scalar_one_or_none()


async def get_backlinks(
    session: AsyncSession,
    note_id: UUID,
    organization_id: UUID,
) -> list[Note]:
    """
    Get notes that reference the given note via wiki-links.

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
    # Search for notes that have the target note in their outgoing_references
    target_urn = f"urn:uniffy:content:NOTE:{note_id}"
    result = await session.execute(
        select(Note).where(
            and_(
                Note.organization_id == organization_id,
                Note.is_deleted == False,  # noqa: E712
                Note.outgoing_references.contains([target_urn]),
            )
        )
    )
    return list(result.scalars().all())


async def soft_delete_recursive(
    session: AsyncSession,
    note: Note,
) -> Note:
    """
    Soft delete a note and all its children recursively.

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
    # First delete children if this is a folder
    if note.node_type == NodeType.FOLDER:
        result = await session.execute(
            select(Note).where(
                Note.parent_id == note.id,
                Note.is_deleted == False,  # noqa: E712
            )
        )
        children = result.scalars().all()
        for child in children:
            await soft_delete_recursive(session, child)

    # Soft delete the note
    note.is_deleted = True
    note.deleted_at = datetime.now(UTC)
    note.updated_at = datetime.now(UTC)

    await session.commit()
    await session.refresh(note)
    return note


async def permanent_delete_recursive(
    session: AsyncSession,
    note: Note,
) -> None:
    """
    Permanently delete a note and all its children.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    note : Note
        Note to delete.

    """
    # First delete children if this is a folder
    if note.node_type == NodeType.FOLDER:
        result = await session.execute(select(Note).where(Note.parent_id == note.id))
        children = result.scalars().all()
        for child in children:
            await permanent_delete_recursive(session, child)

    await session.delete(note)
    await session.commit()


async def empty_trash(
    session: AsyncSession,
    organization_id: UUID,
) -> int:
    """
    Permanently delete all soft-deleted notes in an organization.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    organization_id : UUID
        Organization ID.

    Returns
    -------
    int
        Number of notes deleted.

    """
    # Get all soft-deleted notes
    result = await session.execute(
        select(Note).where(
            and_(
                Note.organization_id == organization_id,
                Note.is_deleted == True,  # noqa: E712
            )
        )
    )
    deleted_notes = list(result.scalars().all())

    if not deleted_notes:
        return 0

    count = len(deleted_notes)
    deleted_ids = {note.id for note in deleted_notes}

    # Unlink orphaned children (non-deleted notes with deleted parents)
    result = await session.execute(
        select(Note).where(
            and_(
                Note.organization_id == organization_id,
                Note.is_deleted == False,  # noqa: E712
                Note.parent_id.in_(deleted_ids),
            )
        )
    )
    for child in result.scalars().all():
        child.parent_id = None
        session.add(child)

    await session.flush()

    # Break FK chains within trash itself
    for note in deleted_notes:
        if note.parent_id in deleted_ids:
            note.parent_id = None
            session.add(note)

    await session.flush()

    # Delete all trash notes
    for note in deleted_notes:
        await session.delete(note)

    await session.commit()
    return count
