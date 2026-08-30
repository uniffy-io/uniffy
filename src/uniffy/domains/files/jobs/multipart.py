"""Hourly cron: abort expired multipart uploads in S3 and prune the table.

Idempotent via `SET NX multipart_reaper:lock` (5 min TTL); S3
`AbortMultipartUpload` is itself a no-op after the first call.
"""

from datetime import UTC, datetime, timedelta
from typing import Any, cast

from loguru import logger
from sqlalchemy import select

from uniffy.core.jobs.locks import acquire_owned_job_lock, release_owned_job_lock
from uniffy.core.models.files.multipart_upload import MultipartUpload, UploadStatus
from uniffy.core.storage import OBJECT_STORAGE_CTX_KEY, ObjectStorage
from uniffy.infrastructure.database.session import open_session
from uniffy.infrastructure.valkey.ops import get_ops_client

logger = logger.bind(component="files.jobs.multipart")

_LOCK_KEY = "multipart_reaper:lock"
REAP_MULTIPART_UPLOADS_JOB_TIMEOUT_SECONDS = 300
_LOCK_TTL_SECONDS = REAP_MULTIPART_UPLOADS_JOB_TIMEOUT_SECONDS + 30
_BATCH_SIZE = 100
_ABORTED_RETENTION_DAYS = 7


async def _acquire_lock() -> str | None:
    client = get_ops_client()
    if client is None:
        return None
    try:
        return await acquire_owned_job_lock(client, _LOCK_KEY, _LOCK_TTL_SECONDS)
    except Exception:
        logger.warning("multipart_reaper: SET NX failed")
        return None


async def _release_lock(token: str) -> None:
    client = get_ops_client()
    if client is None:
        return
    try:
        await release_owned_job_lock(client, _LOCK_KEY, token)
    except Exception:
        logger.warning("multipart_reaper: DEL failed")


async def reap_expired_multipart_uploads(ctx: dict[str, Any]) -> dict[str, Any]:
    """Abort expired multipart uploads in S3 and prune long-stale rows."""
    lock_token = await _acquire_lock()
    if lock_token is None:
        return {"status": "skipped", "reason": "lock_held"}

    aborted_in_s3 = 0
    marked_expired = 0
    purged_aborted = 0

    try:
        storage = cast(ObjectStorage, ctx[OBJECT_STORAGE_CTX_KEY])
        now = datetime.now(UTC)

        async with open_session() as session:
            expired_result = await session.execute(
                select(MultipartUpload)
                .where(
                    MultipartUpload.status == UploadStatus.ACTIVE,
                    MultipartUpload.expires_at <= now,
                )
                .limit(_BATCH_SIZE)
            )
            expired = list(expired_result.scalars().all())

            for upload in expired:
                try:
                    await storage.abort_multipart_upload(
                        key=upload.storage_key,
                        upload_id=upload.s3_upload_id,
                    )
                    aborted_in_s3 += 1
                except Exception as exc:
                    logger.warning(
                        "multipart_reaper: S3 abort failed for "
                        f"upload={upload.id} key={upload.storage_key}: {exc}"
                    )
                upload.status = UploadStatus.EXPIRED
                upload.updated_at = now
                marked_expired += 1

            await session.commit()

            old_aborted_cutoff = now - timedelta(days=_ABORTED_RETENTION_DAYS)
            stale_result = await session.execute(
                select(MultipartUpload)
                .where(
                    MultipartUpload.status.in_([UploadStatus.ABORTED, UploadStatus.EXPIRED]),
                    MultipartUpload.updated_at <= old_aborted_cutoff,
                )
                .limit(_BATCH_SIZE)
            )
            stale = list(stale_result.scalars().all())
            for upload in stale:
                await session.delete(upload)
                purged_aborted += 1

            await session.commit()

        return {
            "status": "success",
            "aborted_in_s3": aborted_in_s3,
            "marked_expired": marked_expired,
            "purged_old_rows": purged_aborted,
        }
    except Exception as exc:
        logger.exception(f"multipart_reaper failed: {exc}")
        return {"status": "error", "error": str(exc)[:500]}
    finally:
        await _release_lock(lock_token)
