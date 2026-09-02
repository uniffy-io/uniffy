"""Transcode WebM screen recordings and atomically swap the live storage object."""

import asyncio
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.jobs.locks import acquire_owned_job_lock, release_owned_job_lock
from uniffy.core.models.files.file import File, TranscodeStatus
from uniffy.core.models.files.file_version import FileVersion
from uniffy.core.search.indexer import SEARCH_INDEXER_CTX_KEY, SearchIndexer, build_content_urn
from uniffy.core.storage import OBJECT_STORAGE_CTX_KEY, ObjectStorage
from uniffy.core.types import ContentType, generate_id
from uniffy.domains.files.jobs.contracts import DELETE_S3_OBJECT
from uniffy.domains.files.operations import FileOperations
from uniffy.infrastructure.database.session import open_session
from uniffy.infrastructure.valkey.ops import get_ops_client

logger = logger.bind(component="files.jobs.transcode")

_LOCK_KEY_TEMPLATE = "transcode_lock:{file_id}"
_FFMPEG_TIMEOUT_SECONDS = int(os.getenv("TRANSCODE_FFMPEG_TIMEOUT", "1800"))
TRANSCODE_JOB_TIMEOUT_SECONDS = _FFMPEG_TIMEOUT_SECONDS + 120
_LOCK_TTL_SECONDS = TRANSCODE_JOB_TIMEOUT_SECONDS
_DELAYED_DELETE_SECONDS = int(os.getenv("TRANSCODE_OLD_KEY_DELETE_DELAY", "86400"))
_HW_ENCODER = os.getenv("TRANSCODE_HW_ENCODER", "").strip()


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


def _ffmpeg_video_codec_args() -> list[str]:
    """Return the H.264 encoder args; hardware encoders are opt-in via `TRANSCODE_HW_ENCODER`."""
    if _HW_ENCODER in {"h264_nvenc", "h264_videotoolbox", "h264_vaapi"}:
        return ["-c:v", _HW_ENCODER, "-preset", "fast"]
    return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"]


async def _run_ffmpeg(input_path: Path, output_path: Path) -> None:
    """Re-encode WebM to H.264/AAC MP4 with `+faststart`.

    Container-only remux is not enough: QuickTime / iOS cannot decode VP9 or
    Opus. `+faststart` moves the moov atom to the head so inline `<video>`
    playback starts before the byte stream finishes.

    The child process is awaited so a long transcode does not stall the
    worker's event loop or its heartbeats.
    """
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        *_ffmpeg_video_codec_args(),
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        str(output_path),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=_FFMPEG_TIMEOUT_SECONDS)
    except TimeoutError:
        proc.kill()
        await proc.wait()
        raise RuntimeError(f"ffmpeg timed out after {_FFMPEG_TIMEOUT_SECONDS}s")
    if proc.returncode != 0:
        message = stderr.decode("utf-8", errors="replace") if stderr else ""
        raise RuntimeError(f"ffmpeg failed: {message[:500]}")


async def transcode_video_to_mp4(
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

    try:
        async with open_session() as session:
            file = await session.get(File, file_uuid)
            if file is None or file.organization_id != org_uuid:
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

        with tempfile.TemporaryDirectory(prefix="uniffy-transcode-") as tmpdir:
            tmp_path = Path(tmpdir)
            webm_path = tmp_path / "in.webm"
            mp4_path = tmp_path / "out.mp4"

            log.info("Downloading WebM source")
            webm_bytes = await storage.download_bytes(old_storage_key)
            webm_path.write_bytes(webm_bytes)
            del webm_bytes

            log.info("Running ffmpeg")
            await _run_ffmpeg(webm_path, mp4_path)

            mp4_size = mp4_path.stat().st_size
            if mp4_size <= 0:
                raise RuntimeError("ffmpeg produced an empty output")

            log.info("Uploading MP4", size=mp4_size, key=new_storage_key)
            mp4_bytes = mp4_path.read_bytes()
            await storage.upload_bytes(
                key=new_storage_key,
                data=mp4_bytes,
                content_type="video/mp4",
            )
            del mp4_bytes

        async with open_session() as session:
            row = await session.execute(select(File).where(File.id == file_uuid).with_for_update())
            file = row.scalar_one_or_none()
            if file is None:
                log.warning("File disappeared during swap")
                await storage.delete_object(new_storage_key)
                return {"status": "not_found", "file_id": file_id}

            if file.transcode_status == TranscodeStatus.COMPLETED:
                log.info("Another worker completed the swap; cleaning up our MP4")
                await storage.delete_object(new_storage_key)
                return {"status": "skipped", "reason": "already_completed"}

            new_version_number = max(current_version, file.version) + 1
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

            await ops.prune_file_versions(file)

        valkey = ctx.get("valkey") if ctx else None
        if valkey is not None and old_storage_key:
            try:
                await valkey.enqueue_job(
                    DELETE_S3_OBJECT.name,
                    old_storage_key,
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

    except Exception as exc:
        log.exception(f"transcode_video_to_mp4 failed: {exc}")
        if new_storage_key and storage is not None:
            try:
                await storage.delete_object(new_storage_key)
            except Exception:
                log.warning("Failed to clean up half-written MP4 on error")
        try:
            async with open_session() as session:
                file = await session.get(File, file_uuid)
                if file is not None and file.transcode_status in (
                    TranscodeStatus.PENDING,
                    TranscodeStatus.PROCESSING,
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
