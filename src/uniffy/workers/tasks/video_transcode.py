"""ARQ task: transcode WebM screen recordings to H.264/AAC MP4.

Brave / Chrome / Firefox produce VP9/Opus WebM via `MediaRecorder`. The
bytes play in the browser fine, but macOS Finder hands `.webm` to the
default browser instead of QuickTime, iOS Files / Photos cannot preview
WebM at all, AirDrop previews break, and older Slack clients reject it.
Safari already produces playable MP4 directly.

This task takes a WebM upload whose filename is already `.mp4` (the
frontend commits to that label from the moment Stop is clicked), runs
ffmpeg to produce a real H.264/AAC MP4, and atomically swaps the live
`storage_key`. The user never sees a format change - only a download
gate while the swap is pending.

Idempotent across the worker fleet via a Valkey ``SET NX`` lock keyed
``transcode_lock:{file_id}`` with a 5-minute TTL. Re-running on a
``COMPLETED`` row is a no-op. The swap itself is a single PG
transaction with ``SELECT ... FOR UPDATE`` so two workers cannot race
to insert duplicate version rows.

On failure the WebM remains the live key and ``transcode_status``
flips to ``FAILED``; the download path then serves the WebM rather
than blocking the user forever.
"""

import os
import subprocess
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.models.files.file import File, TranscodeStatus
from uniffy.core.models.files.file_version import FileVersion
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.storage import get_s3_client
from uniffy.core.types import ContentType, generate_id
from uniffy.core.valkey.ops import _get_ops_client
from uniffy.db.session import open_session
from uniffy.domains.files.operations import FileOperations

_LOCK_TTL_SECONDS = 300
_LOCK_KEY_TEMPLATE = "transcode_lock:{file_id}"
_FFMPEG_TIMEOUT_SECONDS = int(os.getenv("TRANSCODE_FFMPEG_TIMEOUT", "1800"))
_DELAYED_DELETE_SECONDS = int(os.getenv("TRANSCODE_OLD_KEY_DELETE_DELAY", "86400"))
_HW_ENCODER = os.getenv("TRANSCODE_HW_ENCODER", "").strip()


async def _acquire_lock(file_id: UUID) -> bool:
    """Try to acquire the transcode lock for a file id."""
    client = _get_ops_client()
    if client is None:
        return False
    try:
        return bool(
            await client.set(
                _LOCK_KEY_TEMPLATE.format(file_id=file_id),
                "1",
                ex=_LOCK_TTL_SECONDS,
                nx=True,
            )
        )
    except Exception:
        logger.warning(
            f"transcode_video_to_mp4: SET NX failed for file {file_id}"
        )
        return False


async def _release_lock(file_id: UUID) -> None:
    """Release the transcode lock (best-effort)."""
    client = _get_ops_client()
    if client is None:
        return
    try:
        await client.delete(_LOCK_KEY_TEMPLATE.format(file_id=file_id))
    except Exception:
        logger.warning(
            f"transcode_video_to_mp4: DEL failed for file {file_id}"
        )


def _ffmpeg_video_codec_args() -> list[str]:
    """Choose the H.264 encoder. Hardware encoders are opt-in via env."""
    if _HW_ENCODER in {"h264_nvenc", "h264_videotoolbox", "h264_vaapi"}:
        return ["-c:v", _HW_ENCODER, "-preset", "fast"]
    return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"]


def _run_ffmpeg(input_path: Path, output_path: Path) -> None:
    """Re-encode a WebM file to H.264/AAC MP4 with faststart.

    Container-only remux is not enough: QuickTime / iOS cannot decode
    VP9 or Opus regardless of container, so we re-encode both tracks.
    `-movflags +faststart` moves the moov atom to the head so progressive
    download / inline `<video>` playback starts before the file is
    fully transferred.
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
    result = subprocess.run(
        cmd,
        capture_output=True,
        timeout=_FFMPEG_TIMEOUT_SECONDS,
    )
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace")
        raise RuntimeError(f"ffmpeg failed: {stderr[:500]}")


async def transcode_video_to_mp4(
    ctx: dict[str, Any],
    file_id: str,
    organization_id: str,
) -> dict[str, Any]:
    """Transcode a WebM File row to H.264/AAC MP4 and swap the storage key.

    Parameters
    ----------
    ctx : dict
        ARQ context. ``ctx["redis"]`` is the ARQ pool used to schedule
        the delayed cleanup of the old WebM key.
    file_id : str
        File UUID as string.
    organization_id : str
        Organization UUID as string.
    """
    log = logger.bind(task="transcode", file_id=file_id)

    try:
        file_uuid = UUID(file_id)
        org_uuid = UUID(organization_id)
    except ValueError:
        log.error("Invalid uuid arguments")
        return {"status": "error", "error": "invalid_uuid"}

    if not await _acquire_lock(file_uuid):
        return {"status": "skipped", "reason": "lock_held", "file_id": file_id}

    s3 = get_s3_client()
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

            file.transcode_status = TranscodeStatus.PROCESSING
            await session.commit()

            old_storage_key = file.storage_key
            old_bucket = file.storage_bucket
            owner_id = file.owner_id
            current_version = file.version

            new_storage_key = (
                f"{org_uuid}/{owner_id}/{generate_id()}/{file.filename}"
            )

        with tempfile.TemporaryDirectory(prefix="uniffy-transcode-") as tmpdir:
            tmp_path = Path(tmpdir)
            webm_path = tmp_path / "in.webm"
            mp4_path = tmp_path / "out.mp4"

            log.info("Downloading WebM source")
            webm_bytes = await s3.download_bytes(old_storage_key)
            webm_path.write_bytes(webm_bytes)
            del webm_bytes

            log.info("Running ffmpeg")
            _run_ffmpeg(webm_path, mp4_path)

            mp4_size = mp4_path.stat().st_size
            if mp4_size <= 0:
                raise RuntimeError("ffmpeg produced an empty output")

            log.info("Uploading MP4", size=mp4_size, key=new_storage_key)
            mp4_bytes = mp4_path.read_bytes()
            await s3.upload_bytes(
                key=new_storage_key,
                data=mp4_bytes,
                content_type="video/mp4",
            )
            del mp4_bytes

        async with open_session() as session:
            row = await session.execute(
                select(File).where(File.id == file_uuid).with_for_update()
            )
            file = row.scalar_one_or_none()
            if file is None:
                log.warning("File disappeared during swap")
                await s3.delete_object(new_storage_key)
                return {"status": "not_found", "file_id": file_id}

            if file.transcode_status == TranscodeStatus.COMPLETED:
                log.info("Another worker completed the swap; cleaning up our MP4")
                await s3.delete_object(new_storage_key)
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

            try:
                await FileOperations(session)._index_for_search(file)
                await session.commit()
            except Exception:
                log.warning("Search re-index failed after transcode swap")

        redis = ctx.get("redis") if ctx else None
        if redis is not None and old_storage_key:
            try:
                await redis.enqueue_job(
                    "delete_s3_object",
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
        if new_storage_key:
            try:
                await s3.delete_object(new_storage_key)
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
        await _release_lock(file_uuid)


async def delete_s3_object(
    ctx: dict[str, Any],
    storage_key: str,
) -> dict[str, Any]:
    """Delete a single S3 object. Used by the delayed cleanup of the
    pre-transcode WebM key 24h after the swap completes. Idempotent:
    deleting a missing key is a no-op in S3.
    """
    s3 = get_s3_client()
    try:
        await s3.delete_object(storage_key)
        return {"status": "success", "storage_key": storage_key}
    except Exception as exc:
        logger.warning(f"delete_s3_object failed for {storage_key}: {exc}")
        return {"status": "error", "error": str(exc)[:500]}
