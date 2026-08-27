"""The file recovery sweep selects only stale, live pending rows."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete

from uniffy.core.models.files.file import (
    ExtractionStatus,
    File,
    ThumbnailStatus,
    TranscodeStatus,
)
from uniffy.core.types import generate_id
from uniffy.domains.files.jobs.recovery import pending_file_processing_query

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _file(env, *, updated_at: datetime) -> File:
    suffix = generate_id().hex[:8]
    return File(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        filename=f"itdb-recovery-{suffix}.txt",
        original_filename=f"itdb-recovery-{suffix}.txt",
        mime_type="text/plain",
        size_bytes=10,
        storage_key=f"itdb/recovery/{suffix}",
        storage_bucket="itdb",
        extraction_status=ExtractionStatus.PENDING,
        thumbnail_status=ThumbnailStatus.SKIPPED,
        transcode_status=TranscodeStatus.NOT_NEEDED,
        created_at=updated_at,
        updated_at=updated_at,
    )


async def test_recovery_scope_excludes_fresh_deleted_and_terminal_rows(session, env) -> None:
    now = datetime.now(UTC)
    old = now - timedelta(minutes=10)
    stale_extraction = _file(env, updated_at=old)
    stale_thumbnail = _file(env, updated_at=old + timedelta(seconds=1))
    stale_thumbnail.mime_type = "image/jpeg"
    stale_thumbnail.extraction_status = ExtractionStatus.COMPLETED
    stale_thumbnail.thumbnail_status = ThumbnailStatus.PENDING
    stale_transcode = _file(env, updated_at=old + timedelta(seconds=2))
    stale_transcode.extraction_status = ExtractionStatus.COMPLETED
    stale_transcode.transcode_status = TranscodeStatus.PENDING
    fresh = _file(env, updated_at=now)
    deleted = _file(env, updated_at=old)
    deleted.is_deleted = True
    terminal = _file(env, updated_at=old)
    terminal.extraction_status = ExtractionStatus.COMPLETED
    rows = [stale_extraction, stale_thumbnail, stale_transcode, fresh, deleted, terminal]
    row_ids = [row.id for row in rows]
    session.add_all(rows)
    await session.commit()

    try:
        selected = (await session.execute(pending_file_processing_query(now))).scalars().all()
        assert {row.id for row in selected} == {
            stale_extraction.id,
            stale_thumbnail.id,
            stale_transcode.id,
        }

        cursor = (stale_extraction.updated_at, stale_extraction.id)
        after = (await session.execute(pending_file_processing_query(now, cursor))).scalars().all()
        assert {row.id for row in after} == {stale_thumbnail.id, stale_transcode.id}
    finally:
        await session.rollback()
        await session.execute(delete(File).where(File.id.in_(row_ids)))
        await session.commit()
