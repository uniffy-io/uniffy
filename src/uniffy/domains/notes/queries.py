"""Note-specific database queries."""

import re
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from uniffy.core.content.references import CanvasNodeType
from uniffy.core.json_codec import loads
from uniffy.core.models.notes.note import Note
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.models.shared import ContentType, NodeType
from uniffy.core.types import slugify  # noqa: F401 - re-exported, used via queries.slugify

# Inline-tag syntax in markdown: ``[[[tag|tagname]]]``. The ``tag|`` prefix
# distinguishes these from URN mentions.
INLINE_TAG_PATTERN = re.compile(r"\[\[\[tag\|([^\]]+)\]\]\]")


def extract_inline_tags_from_content(content: str) -> list[str]:
    """Return unique inline-tag names (lowercase, sorted) from ``content``."""
    if not content:
        return []

    tags: set[str] = set()
    for match in INLINE_TAG_PATTERN.finditer(content):
        tag_name = match.group(1).strip().lower()
        if tag_name:
            tags.add(tag_name)

    return sorted(tags)


def extract_inline_tags_from_canvas(canvas_data: dict | str) -> list[str]:
    """Return unique inline-tag names found across canvas text nodes."""
    if not canvas_data:
        return []

    if isinstance(canvas_data, str):
        try:
            data = loads(canvas_data)
        except ValueError, TypeError:
            return []
    else:
        data = canvas_data

    nodes = data.get("nodes", [])
    tags: set[str] = set()

    for node in nodes:
        node_data = node.get("data", {})
        if node_data.get("type") == CanvasNodeType.TEXT:
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
    access_filter: ColumnElement[bool],
) -> list[Note]:
    """Return notes whose ``outgoing_references`` contains ``note_id``."""
    target_urn = f"urn:uniffy:content:NOTE:{note_id}"
    result = await session.execute(
        select(Note).where(
            and_(
                Note.organization_id == organization_id,
                Note.is_deleted == False,  # noqa: E712
                Note.outgoing_references.contains([target_urn]),
                access_filter,
            )
        )
    )
    return list(result.scalars().all())


async def soft_delete_recursive(
    session: AsyncSession,
    note: Note,
) -> Note:
    """Soft-delete ``note`` and every descendant under a folder."""
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
    """Hard-delete ``note`` and every descendant under a folder."""
    if note.node_type == NodeType.FOLDER:
        result = await session.execute(select(Note).where(Note.parent_id == note.id))
        children = result.scalars().all()
        for child in children:
            await permanent_delete_recursive(session, child)

    await session.execute(
        delete(RealtimeYjsSnapshot).where(
            RealtimeYjsSnapshot.content_type == ContentType.NOTE,
            RealtimeYjsSnapshot.content_id == note.id,
        )
    )
    await session.delete(note)
    await session.commit()


async def empty_trash(
    session: AsyncSession,
    organization_id: UUID,
    note_ids: list[UUID],
) -> int:
    """Hard-delete the already-authorized soft-deleted notes."""
    if not note_ids:
        return 0
    result = await session.execute(
        select(Note).where(
            Note.id.in_(note_ids),
            Note.is_deleted.is_(True),
        )
    )
    deleted_notes = list(result.scalars().all())

    if not deleted_notes:
        return 0

    count = len(deleted_notes)
    deleted_ids = {note.id for note in deleted_notes}

    # Re-parent live children whose parent is about to vanish.
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

    # Break FK chains within trash itself before the cascade fires.
    for note in deleted_notes:
        if note.parent_id in deleted_ids:
            note.parent_id = None
            session.add(note)

    await session.flush()

    await session.execute(
        delete(RealtimeYjsSnapshot).where(
            RealtimeYjsSnapshot.content_type == ContentType.NOTE,
            RealtimeYjsSnapshot.content_id.in_(deleted_ids),
        )
    )

    for note in deleted_notes:
        await session.delete(note)

    await session.commit()
    return count
