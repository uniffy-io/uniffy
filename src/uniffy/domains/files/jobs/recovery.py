"""Recover file-processing jobs whose PostgreSQL pending state outlived enqueue."""

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, func, or_, select
from sqlalchemy.sql import Select

from uniffy.core.models.files.file import (
    ExtractionStatus,
    File,
    ThumbnailStatus,
    TranscodeStatus,
)
from uniffy.db import open_session
from uniffy.domains.files.jobs.processing import file_processing_job_id, pending_jobs_for_file
from uniffy.domains.files.jobs.transcode import TRANSCODE_JOB_TIMEOUT_SECONDS

logger = logger.bind(component="files.jobs.recovery")

_STALE_AFTER = timedelta(minutes=5)
_STALE_PROCESSING_AFTER = timedelta(minutes=10)
_STALE_TRANSCODE_AFTER = timedelta(seconds=TRANSCODE_JOB_TIMEOUT_SECONDS + 300)
_BATCH_SIZE = 100
_MAX_ROWS = 500

type RecoveryCursor = tuple[datetime, UUID]


def pending_file_processing_query(
    now: datetime,
    cursor: RecoveryCursor | None = None,
) -> Select[tuple[File]]:
    changed_at = func.coalesce(File.updated_at, File.created_at)
    pending_cutoff = now - _STALE_AFTER
    processing_cutoff = now - _STALE_PROCESSING_AFTER
    transcode_cutoff = now - _STALE_TRANSCODE_AFTER
    predicates = [
        File.is_deleted.is_(False),
        or_(
            and_(
                changed_at <= pending_cutoff,
                or_(
                    File.thumbnail_status == ThumbnailStatus.PENDING,
                    File.extraction_status == ExtractionStatus.PENDING,
                    File.transcode_status == TranscodeStatus.PENDING,
                ),
            ),
            and_(
                changed_at <= processing_cutoff,
                or_(
                    File.thumbnail_status == ThumbnailStatus.PROCESSING,
                    File.extraction_status == ExtractionStatus.PROCESSING,
                ),
            ),
            and_(
                changed_at <= transcode_cutoff,
                File.transcode_status == TranscodeStatus.PROCESSING,
            ),
        ),
    ]
    if cursor is not None:
        cursor_time, cursor_id = cursor
        predicates.append(
            or_(
                changed_at > cursor_time,
                and_(changed_at == cursor_time, File.id > cursor_id),
            )
        )
    return select(File).where(*predicates).order_by(changed_at, File.id).limit(_BATCH_SIZE)


async def recover_pending_file_processing(ctx: dict[str, Any]) -> dict[str, Any]:
    queue = ctx.get("valkey")
    if queue is None:
        return {"status": "skipped", "reason": "queue_unavailable"}

    now = datetime.now(UTC)
    cursor: RecoveryCursor | None = None
    scanned = 0
    enqueued = 0
    deduplicated = 0
    failed = 0

    while scanned < _MAX_ROWS:
        async with open_session() as session:
            rows = list(
                (
                    await session.execute(
                        pending_file_processing_query(now, cursor),
                    )
                )
                .scalars()
                .all()
            )
        if not rows:
            break

        for file in rows:
            scanned += 1
            for ref in pending_jobs_for_file(file):
                try:
                    job = await queue.enqueue_job(
                        ref.name,
                        str(file.id),
                        str(file.organization_id),
                        _job_id=file_processing_job_id(ref, file.id, file.version),
                    )
                    if job is None:
                        deduplicated += 1
                    else:
                        enqueued += 1
                except Exception:
                    failed += 1
                    logger.opt(exception=True).warning(
                        "Failed to recover file-processing job",
                        file_id=str(file.id),
                        job=ref.name,
                    )

        last = rows[-1]
        cursor = (last.updated_at or last.created_at, last.id)
        if len(rows) < _BATCH_SIZE:
            break

    return {
        "status": "complete",
        "scanned": scanned,
        "enqueued": enqueued,
        "deduplicated": deduplicated,
        "failed": failed,
    }
