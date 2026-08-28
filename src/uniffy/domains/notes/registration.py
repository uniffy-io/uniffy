"""Register notes with generic content infrastructure."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.registry import (
    register_attachment_cascade_loader,
    register_content_loader,
)
from uniffy.core.models.notes.note import Note
from uniffy.core.types import ContentType


async def _load_note(
    session: AsyncSession,
    organization_id: UUID,
    content_id: UUID,
) -> Note | None:
    return (
        await session.execute(
            select(Note).where(
                Note.id == content_id,
                Note.organization_id == organization_id,
            )
        )
    ).scalar_one_or_none()


async def _note_attachment_cascade(
    session: AsyncSession,
    organization_id: UUID,
    parent_id: UUID,
) -> list[tuple[ContentType, UUID]]:
    affected: list[tuple[ContentType, UUID]] = []
    stack = [parent_id]
    seen: set[UUID] = set()
    while stack:
        current = stack.pop()
        child_ids = (
            (
                await session.execute(
                    select(Note.id).where(
                        Note.parent_id == current,
                        Note.organization_id == organization_id,
                        Note.is_deleted == False,  # noqa: E712
                    )
                )
            )
            .scalars()
            .all()
        )
        for child_id in child_ids:
            if child_id in seen:
                continue
            seen.add(child_id)
            affected.append((ContentType.NOTE, child_id))
            stack.append(child_id)
    return affected


def register_note_content() -> None:
    register_content_loader(ContentType.NOTE, _load_note)
    register_attachment_cascade_loader(ContentType.NOTE, _note_attachment_cascade)
