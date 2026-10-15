"""Inline-attachment reconciliation boundary for content owners."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.files.reconciliation import InlineAttachmentReconciliation
from uniffy.core.search import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.core.types import ContentType
from uniffy.domains.files.attachments.operations import AttachmentOperations


async def reconcile_inline_attachments(
    session: AsyncSession,
    storage: ObjectStorage,
    search_indexer: SearchIndexer,
    *,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    referenced_file_ids: set[UUID],
) -> int:
    return await AttachmentOperations(session, storage, search_indexer).reconcile_inline_attachments(
        organization_id,
        content_type,
        content_id,
        referenced_file_ids,
    )


async def stage_inline_reconciliation(
    session: AsyncSession, content_type: ContentType, content_id: UUID, organization_id: UUID
) -> None:
    await session.execute(
        insert(InlineAttachmentReconciliation)
        .values(
            content_type=content_type.value,
            content_id=content_id,
            organization_id=organization_id,
            attempted_at=datetime.now(UTC),
        )
        .on_conflict_do_nothing()
    )
