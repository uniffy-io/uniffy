"""Inline-attachment reconciliation boundary for content owners."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.storage import ObjectStorage
from uniffy.core.types import ContentType
from uniffy.domains.files.attachments.operations import AttachmentOperations


async def reconcile_inline_attachments(
    session: AsyncSession,
    storage: ObjectStorage,
    *,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    referenced_file_ids: set[UUID],
) -> int:
    return await AttachmentOperations(session, storage).reconcile_inline_attachments(
        organization_id,
        content_type,
        content_id,
        referenced_file_ids,
    )
