"""Parent-destruction contract for attachment cleanup."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.types import ContentType
from uniffy.domains.files.attachments.operations import AttachmentOperations


async def purge_attachments_for_content(
    session: AsyncSession,
    *,
    organization_id: UUID,
    content_type: ContentType,
    content_ids: list[UUID],
) -> int:
    return await AttachmentOperations(session).purge_attachments_for_content(
        organization_id,
        content_type,
        content_ids,
    )
