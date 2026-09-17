"""Reap abandoned playback objects using durable storage identities."""

from datetime import UTC, datetime, timedelta

from botocore.exceptions import ClientError
from loguru import logger
from sqlalchemy import exists, or_, select
from sqlalchemy.sql import Select

from uniffy.core.models.files.file import File, PlaybackStatus
from uniffy.core.models.files.file_version import FileVersion
from uniffy.core.models.files.rendition import FileRendition
from uniffy.core.storage import ObjectStorage
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="files.jobs.cleanup")


def expired_renditions_query(now: datetime) -> Select[tuple[FileRendition]]:
    protected = exists().where(
        File.id == FileRendition.file_id,
        File.playback_key == FileRendition.storage_key,
        File.playback_version == File.version,
        File.playback_status == PlaybackStatus.COMPLETED,
    )
    protected_source = exists().where(File.storage_key == FileRendition.storage_key)
    protected_version = exists().where(FileVersion.storage_key == FileRendition.storage_key)
    return (
        select(FileRendition)
        .where(
            FileRendition.expires_at <= now,
            ~or_(protected, protected_source, protected_version),
        )
        .order_by(FileRendition.expires_at)
        .limit(100)
    )


async def cleanup_renditions(storage: ObjectStorage) -> int:
    removed = 0
    async with open_session() as session:
        records = (
            (await session.execute(expired_renditions_query(datetime.now(UTC)))).scalars().all()
        )
        for record in records:
            try:
                if record.upload_id:
                    try:
                        await storage.abort_multipart_upload(record.storage_key, record.upload_id)
                    except ClientError as error:
                        if error.response.get("Error", {}).get("Code") != "NoSuchUpload":  # noqa: PLR2004 - S3 error code.
                            raise
                await storage.delete_object(record.storage_key)
                await session.delete(record)
                removed += 1
            except Exception:
                logger.opt(exception=True).warning(
                    "Rendition cleanup failed", key=record.storage_key
                )
                record.expires_at = datetime.now(UTC) + timedelta(minutes=5)
        await session.commit()
    return removed
