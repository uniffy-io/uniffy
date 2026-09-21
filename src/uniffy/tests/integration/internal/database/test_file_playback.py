from datetime import UTC, datetime, timedelta
from dataclasses import replace
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from sqlalchemy import delete, select, update

from uniffy.core.models.files.file import File, PlaybackStatus, ExtractionStatus, TranscodeStatus
from uniffy.core.models.files.file_version import FileVersion
from uniffy.core.models.files.rendition import FileRendition
from uniffy.core.types import generate_id
from uniffy.core.storage import OBJECT_STORAGE_CTX_KEY
from uniffy.core.search.indexer import SEARCH_INDEXER_CTX_KEY
from uniffy.domains.files.jobs import playback
from uniffy.domains.files.jobs import cleanup, renditions, transcode
from uniffy.domains.files.jobs.cleanup import expired_renditions_query
from uniffy.domains.files.jobs.processing import reset_playback
from uniffy.domains.files.jobs.media import probe, is_web_safe
from uniffy.domains.files.jobs.slots import MEDIA_SLOTS_CTX_KEY, MediaSlots
from uniffy.domains.files.jobs.settings import MEDIA_SETTINGS
from uniffy.domains.files.jobs.source import MEDIA_SOURCE_CTX_KEY, MediaSourceServer
from uniffy.domains.files.routes import stream_media
from uniffy.infrastructure.storage import S3Storage

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest_asyncio.fixture(loop_scope="session")
async def media_sources():
    storage = S3Storage()
    await storage.startup()
    sources = MediaSourceServer(storage)
    await sources.startup()
    try:
        yield storage, sources
    finally:
        await sources.shutdown()
        await storage.shutdown()


@pytest_asyncio.fixture(loop_scope="session")
async def video(session, env):
    file = File(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        filename="clip.mov",
        original_filename="clip.mov",
        mime_type="video/quicktime",
        storage_key=f"test/playback/{generate_id()}",
        storage_bucket="test",
        size_bytes=10,
        extraction_status=ExtractionStatus.SKIPPED,
        playback_status=PlaybackStatus.PENDING,
    )
    session.add(file)
    await session.commit()
    file_id = file.id
    try:
        yield file
    finally:
        await session.rollback()
        await session.execute(delete(FileRendition).where(FileRendition.file_id == file_id))
        await session.execute(update(File).where(File.id == file_id).values(current_version_id=None))
        await session.execute(delete(FileVersion).where(FileVersion.file_id == file_id))
        await session.execute(delete(File).where(File.id == file_id))
        await session.commit()


async def test_replacement_rejects_old_success_and_old_failure(session, video):
    claim = await playback.claim_playback(video.id, video.organization_id)
    assert claim is not None
    await session.refresh(video)
    video.version += 1
    video.storage_key = "replacement"
    reset_playback(video)
    await session.commit()
    assert not await playback.finish_playback(claim, PlaybackStatus.COMPLETED)
    assert not await playback.finish_playback(claim, PlaybackStatus.FAILED, "old failure")
    await session.refresh(video)
    assert video.playback_status == PlaybackStatus.PENDING
    assert video.playback_key is None


async def test_crashed_processing_is_reclaimed_and_old_attempt_cannot_finish(session, video):
    first = await playback.claim_playback(video.id, video.organization_id)
    assert first is not None
    assert await playback.claim_playback(video.id, video.organization_id) is None
    await session.refresh(video)
    video.playback_started_at = datetime.now(UTC) - timedelta(
        seconds=playback.MEDIA_SETTINGS.job_timeout + 120
    )
    await session.commit()
    second = await playback.claim_playback(video.id, video.organization_id)
    assert second is not None and second.attempt == 2 and first.output_key != second.output_key
    assert not await playback.finish_playback(first, PlaybackStatus.COMPLETED)
    assert await playback.finish_playback(second, PlaybackStatus.COMPLETED)


async def test_disabled_conversion_is_terminal_and_wrong_org_cannot_claim(
    session, video, monkeypatch
):
    assert await playback.claim_playback(video.id, generate_id()) is None
    monkeypatch.setattr(playback, "MEDIA_SETTINGS", replace(playback.MEDIA_SETTINGS, enabled=False))
    assert await playback.claim_playback(video.id, video.organization_id) is None
    await session.refresh(video)
    assert video.playback_status == PlaybackStatus.FAILED
    assert video.playback_attempts == 0


async def test_retry_attempts_are_durable_and_stop_after_three(session, video):
    for count in range(1, 4):
        claim = await playback.claim_playback(video.id, video.organization_id)
        assert claim is not None and claim.attempt == count
        assert await playback.finish_playback(claim, PlaybackStatus.PENDING, "storage unavailable")
    assert await playback.claim_playback(video.id, video.organization_id) is None
    await session.refresh(video)
    assert video.playback_status == PlaybackStatus.FAILED


async def test_cleanup_retains_current_copy_but_survives_file_purge(session, video):
    claim = await playback.claim_playback(video.id, video.organization_id)
    assert await playback.finish_playback(claim, PlaybackStatus.COMPLETED)
    record = await session.get(FileRendition, claim.output_key)
    record.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await session.commit()
    query = expired_renditions_query(datetime.now(UTC)).where(FileRendition.file_id == video.id)
    assert not (await session.execute(query)).scalars().all()
    await session.execute(delete(File).where(File.id == video.id))
    await session.commit()
    assert [row.storage_key for row in (await session.execute(query)).scalars()] == [
        claim.output_key
    ]


async def test_real_storage_conversion_range_copy_and_cleanup(
    session, video, monkeypatch, tmp_path, video_samples, media_sources
):
    storage, sources = media_sources
    source = video_samples / "hevc.mp4"
    original = source.read_bytes()
    source_key = video.storage_key
    copied_key = source_key + "/copied"
    file_id, org_id, owner_id = video.id, video.organization_id, video.owner_id

    monkeypatch.setattr(renditions, "publish_notification", AsyncMock())
    query = cleanup.expired_renditions_query
    monkeypatch.setattr(
        cleanup,
        "expired_renditions_query",
        lambda now: query(now).where(FileRendition.file_id == file_id),
    )
    output_key = None
    try:
        await storage.upload_bytes(source_key, original, "video/mp4")
        await renditions.generate_playback_rendition(
            {
                OBJECT_STORAGE_CTX_KEY: storage,
                MEDIA_SLOTS_CTX_KEY: MediaSlots(1, MEDIA_SETTINGS),
                MEDIA_SOURCE_CTX_KEY: sources,
            },
            str(file_id),
            str(org_id),
        )
        await session.refresh(video)
        assert video.playback_status == PlaybackStatus.COMPLETED
        assert video.storage_key == source_key and video.version == 1
        output_key = video.playback_key
        assert await storage.download_bytes(source_key) == original
        output = tmp_path / "playback.mp4"
        output.write_bytes(await storage.download_bytes(output_key))
        assert is_web_safe(await probe(output))
        response = await stream_media(
            storage, org_id, file_id, owner_id, "bytes=0-31", playback_version=1
        )
        assert response.status_code == 206
        assert (
            b"".join([chunk async for chunk in response.body_iterator]) == output.read_bytes()[:32]
        )
        await storage.copy_object(source_key, copied_key)
        assert await storage.download_bytes(copied_key) == original
        record = await session.get(FileRendition, output_key)
        assert record.upload_id
        record.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        reset_playback(video)
        video.playback_status = PlaybackStatus.NOT_NEEDED
        await session.commit()

        delete_object = storage.delete_object
        monkeypatch.setattr(
            storage, "delete_object", AsyncMock(side_effect=OSError("temporary outage"))
        )
        assert await cleanup.cleanup_renditions(storage) == 0
        await session.refresh(record)
        assert record.expires_at > datetime.now(UTC)
        record.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await session.commit()
        monkeypatch.setattr(storage, "delete_object", delete_object)
        assert await cleanup.cleanup_renditions(storage) == 1
        assert not await storage.object_exists(output_key)
        assert await storage.object_exists(source_key)
    finally:
        await storage.delete_object(source_key)
        await storage.delete_object(copied_key)
        if output_key:
            await storage.delete_object(output_key)


async def test_recording_prune_failure_keeps_published_mp4(
    session, video, monkeypatch, video_samples, media_sources
):
    storage, sources = media_sources
    source = video_samples / "vp9.webm"
    video.filename = "recording.mp4"
    video.mime_type = "video/webm"
    video.transcode_status = TranscodeStatus.PENDING
    video.playback_status = PlaybackStatus.NOT_NEEDED
    await session.commit()
    source_key, file_id, org_id = video.storage_key, video.id, video.organization_id
    monkeypatch.setattr(transcode, "_acquire_lock", AsyncMock(return_value="owned"))
    monkeypatch.setattr(transcode, "_release_lock", AsyncMock())
    monkeypatch.setattr(transcode, "publish_notification", AsyncMock())
    monkeypatch.setattr(transcode.FileOperations, "_index_for_search", AsyncMock())
    monkeypatch.setattr(
        transcode.FileOperations,
        "prune_file_versions",
        AsyncMock(side_effect=OSError("unavailable")),
    )
    output_key = None
    try:
        await storage.upload_bytes(source_key, source.read_bytes(), "video/webm")
        result = await transcode._transcode_video_to_mp4(
            {
                OBJECT_STORAGE_CTX_KEY: storage,
                SEARCH_INDEXER_CTX_KEY: MagicMock(),
                MEDIA_SOURCE_CTX_KEY: sources,
            },
            str(file_id),
            str(org_id),
        )
        assert result["status"] == "success"
        await session.refresh(video)
        output_key = video.storage_key
        assert output_key != source_key and video.version == 2
        assert video.transcode_status == TranscodeStatus.COMPLETED
        assert await storage.object_exists(output_key)
        record = await session.get(FileRendition, output_key)
        record.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await session.commit()
        query = expired_renditions_query(datetime.now(UTC)).where(FileRendition.file_id == file_id)
        assert not (await session.execute(query)).scalars().all()
    finally:
        await storage.delete_object(source_key)
        if output_key:
            await storage.delete_object(output_key)
