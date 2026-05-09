"""ARQ cron task: reap expired multipart uploads.

Runs hourly. Scans `files_multipart_uploads` for rows where
`expires_at <= now() AND status = 'ACTIVE'`, calls S3
`abort_multipart_upload` to free the storage allocation, and flips
`status` to `EXPIRED`. Also reaps `ABORTED` rows whose `updated_at`
is older than 7 days so the table doesn't grow unbounded.

Idempotent across the worker fleet via a Valkey ``SET NX`` lock keyed
``multipart_reaper:lock`` with a 5-minute TTL. If two pods schedule the
cron at the same tick, only one acquires the lock and runs the scan.

S3 ``AbortMultipartUpload`` is itself idempotent (a no-op when the
upload id has already been aborted), so even if the lock expired
mid-scan and another worker started, double-abort is safe.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

from loguru import logger
from sqlalchemy import select

from uniffy.core.models.files.multipart_upload import MultipartUpload, UploadStatus
from uniffy.core.storage import get_s3_client
from uniffy.core.valkey.ops import _get_ops_client
from uniffy.db.session import open_session

_LOCK_KEY = "multipart_reaper:lock"
_LOCK_TTL_SECONDS = 300
_BATCH_SIZE = 100
_ABORTED_RETENTION_DAYS = 7


async def _acquire_lock() -> bool:
    """Try to acquire the reaper lock. Returns True on success."""
    client = _get_ops_client()
    if client is None:
        return False
    try:
        return bool(await client.set(_LOCK_KEY, "1", ex=_LOCK_TTL_SECONDS, nx=True))
    except Exception:
        logger.warning("multipart_reaper: SET NX failed")
        return False


async def _release_lock() -> None:
    """Release the reaper lock (best-effort)."""
    client = _get_ops_client()
    if client is None:
        return
    try:
        await client.delete(_LOCK_KEY)
    except Exception:
        logger.warning("multipart_reaper: DEL failed")


async def reap_expired_multipart_uploads(ctx: dict[str, Any]) -> dict[str, Any]:
    """Abort expired multipart uploads and free the S3 allocation.

    Scoped to one worker per tick via a Valkey lock so two pods don't fight
    over the same rows.
    """
    if not await _acquire_lock():
        return {"status": "skipped", "reason": "lock_held"}

    aborted_in_s3 = 0
    marked_expired = 0
    purged_aborted = 0

    try:
        s3 = get_s3_client()
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
                    await s3.abort_multipart_upload(
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
                    MultipartUpload.status.in_(
                        [UploadStatus.ABORTED, UploadStatus.EXPIRED]
                    ),
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
        await _release_lock()
