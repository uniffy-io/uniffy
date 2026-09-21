"""Transcode WebM screen recordings and atomically swap the live storage object."""

import asyncio
import os
import tempfile
from datetime import UTC, datetime, timedelta
from functools import partial
from pathlib import Path
from typing import Any, cast
from uuid import UUID

from loguru import logger
from sqlalchemy import select, update

from uniffy.core.events.realtime import NotificationPayloadType, publish_notification
from uniffy.core.jobs.locks import acquire_owned_job_lock, release_owned_job_lock
from uniffy.core.models.files.file import File, PlaybackStatus, TranscodeStatus
from uniffy.core.models.files.file_version import FileVersion
from uniffy.core.models.files.rendition import FileRendition
from uniffy.core.search.indexer import SEARCH_INDEXER_CTX_KEY, SearchIndexer, build_content_urn
from uniffy.core.storage import OBJECT_STORAGE_CTX_KEY, ObjectStorage
from uniffy.core.types import ContentType, generate_id
from uniffy.domains.files.jobs.contracts import DELETE_S3_OBJECT
from uniffy.domains.files.jobs.media import MediaError, MediaSource, probe, rendition_args, run_media
from uniffy.domains.files.jobs.playback import record_multipart
from uniffy.domains.files.jobs.scratch import upload_video
from uniffy.domains.files.jobs.settings import MEDIA_SETTINGS
from uniffy.domains.files.jobs.slots import MEDIA_SLOTS_CTX_KEY, MediaSlots
from uniffy.domains.files.jobs.source import MEDIA_SOURCE_CTX_KEY, MediaSourceServer
from uniffy.domains.files.operations import FileOperations
from uniffy.infrastructure.database.session import open_session
from uniffy.infrastructure.valkey.ops import get_ops_client
from uniffy.vendor.arq import Retry

logger = logger.bind(component="files.jobs.transcode")

_LOCK_KEY_TEMPLATE = "transcode_lock:{file_id}"
_FFMPEG_TIMEOUT_SECONDS = int(os.getenv("TRANSCODE_FFMPEG_TIMEOUT", "1800"))
TRANSCODE_JOB_TIMEOUT_SECONDS = MEDIA_SETTINGS.job_timeout
_LOCK_TTL_SECONDS = TRANSCODE_JOB_TIMEOUT_SECONDS
_DELAYED_DELETE_SECONDS = int(os.getenv("TRANSCODE_OLD_KEY_DELETE_DELAY", "86400"))


async def _acquire_lock(file_id: UUID) -> str | None:
    client = get_ops_client()
    if client is None:
        return None
    try:
        return await acquire_owned_job_lock(
            client,
            _LOCK_KEY_TEMPLATE.format(file_id=file_id),
            _LOCK_TTL_SECONDS,
        )
    except Exception:
        logger.warning(f"transcode_video_to_mp4: SET NX failed for file {file_id}")
        return None


async def _release_lock(file_id: UUID, token: str) -> None:
    client = get_ops_client()
    if client is None:
        return
    try:
        await release_owned_job_lock(
            client,
            _LOCK_KEY_TEMPLATE.format(file_id=file_id),
            token,
        )
    except Exception:
        logger.warning(f"transcode_video_to_mp4: DEL failed for file {file_id}")


async def _run_ffmpeg(input_path: Path | MediaSource, output_path: Path) -> None:
    info = await probe(input_path)
    if info.duration > MEDIA_SETTINGS.max_duration_seconds:
        raise MediaError("Recording exceeds duration limit")
    await run_media(
        "ffmpeg",
        rendition_args(input_path, output_path, info, MEDIA_SETTINGS),
        max(_FFMPEG_TIMEOUT_SECONDS, info.duration * 4),
    )
    result = await probe(output_path)
    if (
        result.duration < info.duration - max(1, info.duration * 0.01)
        or output_path.stat().st_size >= MEDIA_SETTINGS.max_output_bytes
    ):
        raise MediaError("Incomplete recording output")


async def transcode_video_to_mp4(
    ctx: dict[str, Any], file_id: str, organization_id: str
) -> dict[str, Any]:
    try:
        UUID(file_id)
        UUID(organization_id)
    except ValueError:
        return {"status": "error", "error": "invalid_uuid"}
    slots = cast(MediaSlots, ctx[MEDIA_SLOTS_CTX_KEY])
    async with slots.acquire() as acquired:
        if not acquired:
            raise Retry(defer=5, count_attempt=False)
        async with asyncio.timeout(TRANSCODE_JOB_TIMEOUT_SECONDS - 30):
            return await _transcode_video_to_mp4(ctx, file_id, organization_id)


async def _transcode_video_to_mp4(
    ctx: dict[str, Any],
    file_id: str,
    organization_id: str,
) -> dict[str, Any]:
    """Transcode a WebM File to MP4 and atomically swap the live `storage_key`."""
    log = logger.bind(task="transcode", file_id=file_id)

    try:
        file_uuid = UUID(file_id)
        org_uuid = UUID(organization_id)
    except ValueError:
        log.error("Invalid uuid arguments")
        return {"status": "error", "error": "invalid_uuid"}

    lock_token = await _acquire_lock(file_uuid)
    if lock_token is None:
        return {"status": "skipped", "reason": "lock_held", "file_id": file_id}

    storage: ObjectStorage | None = None
    old_storage_key: str | None = None
    new_storage_key: str | None = None
    current_version: int | None = None

    try:
        async with open_session() as session:
            file = await session.get(File, file_uuid)
            if file is None or file.organization_id != org_uuid or file.is_deleted:
                log.warning("File not found")
                return {"status": "not_found", "file_id": file_id}

            if file.transcode_status == TranscodeStatus.COMPLETED:
                return {"status": "skipped", "reason": "already_completed"}
            if file.transcode_status == TranscodeStatus.NOT_NEEDED:
                return {"status": "skipped", "reason": "not_needed"}

            storage = cast(ObjectStorage, ctx[OBJECT_STORAGE_CTX_KEY])
            file.transcode_status = TranscodeStatus.PROCESSING
            await session.commit()

            old_storage_key = file.storage_key
            old_bucket = file.storage_bucket
            owner_id = file.owner_id
            current_version = file.version

            new_storage_key = f"{org_uuid}/{owner_id}/{generate_id()}/{file.filename}"
            session.add(
                FileRendition(
                    storage_key=new_storage_key,
                    file_id=file.id,
                    expires_at=datetime.now(UTC)
                    + timedelta(seconds=TRANSCODE_JOB_TIMEOUT_SECONDS + 120),
                )
            )
            await session.commit()

        with tempfile.TemporaryDirectory(
            prefix="uniffy-transcode-", dir=MEDIA_SETTINGS.scratch_directory
        ) as tmpdir:
            mp4_path = Path(tmpdir) / "out.mp4"
            sources = cast(MediaSourceServer, ctx[MEDIA_SOURCE_CTX_KEY])
            async with sources.open(old_storage_key, MEDIA_SETTINGS.max_source_bytes) as source:
                log.info("Running ffmpeg")
                await _run_ffmpeg(source, mp4_path)

            mp4_size = mp4_path.stat().st_size
            if mp4_size <= 0:
                raise RuntimeError("ffmpeg produced an empty output")

            log.info("Uploading MP4", size=mp4_size, key=new_storage_key)
            await upload_video(
                storage, new_storage_key, mp4_path, partial(record_multipart, new_storage_key)
            )

        async with open_session() as session:
            row = await session.execute(select(File).where(File.id == file_uuid).with_for_update())
            file = row.scalar_one_or_none()
            if (
                file is None
                or file.is_deleted
                or file.organization_id != org_uuid
                or file.version != current_version
                or file.storage_key != old_storage_key
            ):
                log.warning("Source changed during swap")
                await storage.delete_object(new_storage_key)
                return {"status": "not_found", "file_id": file_id}

            if file.transcode_status == TranscodeStatus.COMPLETED:
                log.info("Another worker completed the swap; cleaning up our MP4")
                await storage.delete_object(new_storage_key)
                return {"status": "skipped", "reason": "already_completed"}

            new_version_number = file.version + 1
            version = FileVersion(
                file_id=file.id,
                version_number=new_version_number,
                size_bytes=mp4_size,
                storage_key=new_storage_key,
                storage_bucket=old_bucket,
                uploaded_by=file.owner_id,
            )
            session.add(version)
            await session.flush()

            file.storage_key = new_storage_key
            file.mime_type = "video/mp4"
            file.size_bytes = mp4_size
            file.current_version_id = version.id
            file.version = new_version_number
            file.transcode_status = TranscodeStatus.COMPLETED
            file.playback_status = PlaybackStatus.NOT_NEEDED
            file.updated_at = datetime.now(UTC)

            await session.commit()
            await session.refresh(file)

            search_indexer = cast(SearchIndexer, ctx[SEARCH_INDEXER_CTX_KEY])
            ops = FileOperations(session, storage, search_indexer)
            try:
                await ops._index_for_search(file)
                await session.commit()
            except Exception:
                log.warning("Search re-index failed after transcode swap")

            try:
                await ops.prune_file_versions(file)
            except Exception:
                log.warning("Version pruning failed after transcode swap")

            # Lets the owner's open tabs lift the download gate and swap in the
            # MP4 without a reload.
            try:
                await publish_notification(
                    file.owner_id,
                    {
                        "_type": NotificationPayloadType.FILE_UPDATED,
                        "file_id": str(file.id),
                        "organization_id": str(file.organization_id),
                    },
                )
            except Exception:
                log.warning("Failed to publish file update event")

        valkey = ctx.get("valkey") if ctx else None
        if valkey is not None and old_storage_key:
            try:
                await valkey.enqueue_job(
                    DELETE_S3_OBJECT.name,
                    old_storage_key,
                    _queue_name=DELETE_S3_OBJECT.queue.valkey_name,
                    _defer_by=_DELAYED_DELETE_SECONDS,
                )
            except Exception:
                log.warning("Failed to schedule delayed delete of WebM key")

        log.info("Transcode complete")
        return {
            "status": "success",
            "file_id": file_id,
            "new_storage_key": new_storage_key,
            "size_bytes": mp4_size,
            "urn": build_content_urn(ContentType.FILE, file_uuid),
        }

    except asyncio.CancelledError:
        if current_version is not None:
            async with open_session() as session:
                await session.execute(
                    update(File)
                    .where(
                        File.id == file_uuid,
                        File.organization_id == org_uuid,
                        File.version == current_version,
                        File.storage_key == old_storage_key,
                        File.transcode_status == TranscodeStatus.PROCESSING,
                        File.is_deleted.is_(False),
                    )
                    .values(transcode_status=TranscodeStatus.PENDING)
                )
                await session.commit()
        raise
    except Exception as exc:
        log.exception(f"transcode_video_to_mp4 failed: {exc}")
        # Durable cleanup checks live references even when commit acknowledgement fails.
        try:
            async with open_session() as session:
                file = await session.get(File, file_uuid)
                if (
                    file is not None
                    and file.version == current_version
                    and file.storage_key == old_storage_key
                    and not file.is_deleted
                    and file.transcode_status
                    in (
                        TranscodeStatus.PENDING,
                        TranscodeStatus.PROCESSING,
                    )
                ):
                    file.transcode_status = TranscodeStatus.FAILED
                    file.updated_at = datetime.now(UTC)
                    await session.commit()
        except Exception:
            log.exception("Failed to mark transcode_status=FAILED")
        return {"status": "error", "error": str(exc)[:500], "file_id": file_id}

    finally:
        await _release_lock(file_uuid, lock_token)


async def delete_s3_object(
    ctx: dict[str, Any],
    storage_key: str,
) -> dict[str, Any]:
    """Delete one S3 object; used 24h after a transcode swap to drop the old WebM."""
    storage = cast(ObjectStorage, ctx[OBJECT_STORAGE_CTX_KEY])
    try:
        await storage.delete_object(storage_key)
        return {"status": "success", "storage_key": storage_key}
    except Exception as exc:
        logger.warning(f"delete_s3_object failed for {storage_key}: {exc}")
        return {"status": "error", "error": str(exc)[:500]}
