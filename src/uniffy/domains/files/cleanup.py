"""Organization-scoped cleanup of a departing member's in-flight uploads."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.files.multipart_upload import MultipartUpload, UploadStatus


async def stage_member_upload_expiry(
    session: AsyncSession,
    *,
    organization_id: UUID,
    user_id: UUID,
    expired_at: datetime,
) -> int:
    """Expire the member's ACTIVE uploads in the caller's transaction.

    An expired upload takes no further parts and cannot complete. The multipart reaper
    aborts its storage parts and marks it EXPIRED, so the caller needs no storage handle.
    """
    result = await session.execute(
        update(MultipartUpload)
        .where(
            MultipartUpload.organization_id == organization_id,
            MultipartUpload.user_id == user_id,
            MultipartUpload.status == UploadStatus.ACTIVE,
            MultipartUpload.expires_at > expired_at,
        )
        .values(expires_at=expired_at, updated_at=expired_at)
    )
    return result.rowcount
