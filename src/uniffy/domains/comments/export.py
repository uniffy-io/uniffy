"""Comment rows for content exports owned by other domains."""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import Select, and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.comments.comment import Comment
from uniffy.core.types import ContentType

EXPORT_BATCH = 1_000


@dataclass(frozen=True)
class CommentExportRow:
    id: UUID
    content_id: UUID
    author_id: UUID
    body: str
    created_at: datetime
    is_resolved: bool


async def stream_comment_rows(
    session: AsyncSession,
    organization_id: UUID,
    content_type: ContentType,
    target_ids: Select,
) -> AsyncIterator[list[CommentExportRow]]:
    """Live comments on the targets in batches; the caller must already have authorized viewing
    every target, since this applies no access check of its own."""
    query = (
        select(
            Comment.id,
            Comment.content_id,
            Comment.author_id,
            Comment.body,
            Comment.created_at,
            Comment.is_resolved,
        )
        .where(
            and_(
                Comment.organization_id == organization_id,
                Comment.content_type == content_type,
                Comment.content_id.in_(target_ids),
                Comment.is_deleted == False,  # noqa: E712
            )
        )
        .order_by(Comment.content_id, Comment.created_at, Comment.id)
    )
    rows = await session.stream(query.execution_options(yield_per=EXPORT_BATCH))
    try:
        async for partition in rows.partitions(EXPORT_BATCH):
            yield [CommentExportRow(*row) for row in partition]
    finally:
        await rows.close()
