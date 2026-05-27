"""Generate JPEG thumbnails for images, PDFs, and videos; upload to S3."""

import io
import subprocess
import tempfile
from pathlib import Path
from typing import Any
from uuid import UUID

import fitz  # PyMuPDF
from arq import Retry
from loguru import logger
from PIL import Image, ImageOps
from sqlalchemy.dialects.postgresql import insert as pg_insert

from uniffy.core.models.files.file import ExtractionStatus, File
from uniffy.core.models.files.media_info import FileMediaInfo
from uniffy.core.storage.s3_client import get_s3_client
from uniffy.core.valkey import publish_notification
from uniffy.db.session import open_session

THUMB_MAX_SIZE = (400, 400)
THUMB_QUALITY = 85
THUMB_FORMAT = "JPEG"


def get_thumbnail_key(organization_id: UUID, file_id: UUID) -> str:
    """Return the S3 key `{org_id}/thumbnails/{file_id}.jpg`."""
    return f"{organization_id}/thumbnails/{file_id}.jpg"


async def generate_image_thumbnail(
    ctx: dict[str, Any],
    file_id: str,
    organization_id: str,
) -> dict[str, Any]:
    """Generate a JPEG thumbnail for an image and upload it to S3."""
    log = logger.bind(task="thumbnail", kind="image", file_id=file_id)
    log.info("Started")

    file_uuid = UUID(file_id)
    org_uuid = UUID(organization_id)

    s3 = get_s3_client()

    async with open_session() as session:
        file = await session.get(File, file_uuid)
        if not file:
            log.warning("File not found")
            return {"status": "not_found", "file_id": file_id}

        file.extraction_status = ExtractionStatus.PROCESSING
        await session.commit()

        try:
            image_bytes = await s3.download_bytes(file.storage_key)
            log.info("Downloaded image", bytes=len(image_bytes))

            thumbnail_bytes, thumb_width, thumb_height = _create_thumbnail(image_bytes)
            log.info(
                "Generated thumbnail",
                thumb_bytes=len(thumbnail_bytes),
                thumb_width=thumb_width,
                thumb_height=thumb_height,
            )

            thumb_key = get_thumbnail_key(org_uuid, file_uuid)
            await s3.upload_bytes(
                key=thumb_key,
                data=thumbnail_bytes,
                content_type="image/jpeg",
            )

            stmt = pg_insert(FileMediaInfo).values(
                file_id=file_uuid,
                thumbnail_key=thumb_key,
                thumbnail_width=thumb_width,
                thumbnail_height=thumb_height,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["file_id"],
                set_={
                    "thumbnail_key": stmt.excluded.thumbnail_key,
                    "thumbnail_width": stmt.excluded.thumbnail_width,
                    "thumbnail_height": stmt.excluded.thumbnail_height,
                },
            )
            await session.execute(stmt)

            file.extraction_status = ExtractionStatus.COMPLETED
            await session.commit()

            try:
                await publish_notification(
                    file.owner_id,
                    {
                        "_type": "file_updated",
                        "file_id": str(file.id),
                        "organization_id": str(file.organization_id),
                    },
                )
            except Exception:
                log.warning("Failed to publish file update event")

            log.info("Done")
            return {"status": "success", "thumbnail_key": thumb_key}

        except Exception as e:
            log.error("Failed", error=str(e))

            job_try = ctx.get("job_try", 1)
            if job_try < 3:
                raise Retry(defer=job_try * 10)

            file.extraction_status = ExtractionStatus.FAILED
            error_stmt = pg_insert(FileMediaInfo).values(
                file_id=file_uuid,
                extraction_error=str(e)[:2000],
            )
            error_stmt = error_stmt.on_conflict_do_update(
                index_elements=["file_id"],
                set_={"extraction_error": error_stmt.excluded.extraction_error},
            )
            await session.execute(error_stmt)
            await session.commit()

            return {"status": "failed", "error": str(e)}


async def generate_pdf_thumbnail(
    ctx: dict[str, Any],
    file_id: str,
    organization_id: str,
) -> dict[str, Any]:
    """Render the first page of a PDF via PyMuPDF and upload it as a JPEG thumbnail."""
    log = logger.bind(task="thumbnail", kind="pdf", file_id=file_id)
    log.info("Started")

    file_uuid = UUID(file_id)
    org_uuid = UUID(organization_id)

    s3 = get_s3_client()

    async with open_session() as session:
        file = await session.get(File, file_uuid)
        if not file:
            log.warning("File not found")
            return {"status": "not_found", "file_id": file_id}

        file.extraction_status = ExtractionStatus.PROCESSING
        await session.commit()

        try:
            pdf_bytes = await s3.download_bytes(file.storage_key)
            log.info("Downloaded PDF", bytes=len(pdf_bytes))

            thumbnail_bytes, thumb_width, thumb_height = _create_pdf_thumbnail(pdf_bytes)

            thumb_key = get_thumbnail_key(org_uuid, file_uuid)
            await s3.upload_bytes(
                key=thumb_key,
                data=thumbnail_bytes,
                content_type="image/jpeg",
            )

            stmt = pg_insert(FileMediaInfo).values(
                file_id=file_uuid,
                thumbnail_key=thumb_key,
                thumbnail_width=thumb_width,
                thumbnail_height=thumb_height,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["file_id"],
                set_={
                    "thumbnail_key": stmt.excluded.thumbnail_key,
                    "thumbnail_width": stmt.excluded.thumbnail_width,
                    "thumbnail_height": stmt.excluded.thumbnail_height,
                },
            )
            await session.execute(stmt)

            file.extraction_status = ExtractionStatus.COMPLETED
            await session.commit()

            try:
                await publish_notification(
                    file.owner_id,
                    {
                        "_type": "file_updated",
                        "file_id": str(file.id),
                        "organization_id": str(file.organization_id),
                    },
                )
            except Exception:
                log.warning("Failed to publish file update event")

            log.info("Done")
            return {"status": "success", "thumbnail_key": thumb_key}

        except Exception as e:
            log.error("Failed", error=str(e))

            job_try = ctx.get("job_try", 1)
            if job_try < 3:
                raise Retry(defer=job_try * 10)

            file.extraction_status = ExtractionStatus.FAILED
            error_stmt = pg_insert(FileMediaInfo).values(
                file_id=file_uuid,
                extraction_error=str(e)[:2000],
            )
            error_stmt = error_stmt.on_conflict_do_update(
                index_elements=["file_id"],
                set_={"extraction_error": error_stmt.excluded.extraction_error},
            )
            await session.execute(error_stmt)
            await session.commit()

            return {"status": "failed", "error": str(e)}


async def generate_video_thumbnail(
    ctx: dict[str, Any],
    file_id: str,
    organization_id: str,
) -> dict[str, Any]:
    """Extract a video frame via ffmpeg and upload it as a JPEG thumbnail."""
    log = logger.bind(task="thumbnail", kind="video", file_id=file_id)
    log.info("Started")

    file_uuid = UUID(file_id)
    org_uuid = UUID(organization_id)

    s3 = get_s3_client()

    async with open_session() as session:
        file = await session.get(File, file_uuid)
        if not file:
            log.warning("File not found")
            return {"status": "not_found", "file_id": file_id}

        file.extraction_status = ExtractionStatus.PROCESSING
        await session.commit()

        try:
            video_bytes = await s3.download_bytes(file.storage_key)
            log.info("Downloaded video", bytes=len(video_bytes))

            thumbnail_bytes, thumb_width, thumb_height = _create_video_thumbnail(video_bytes)

            thumb_key = get_thumbnail_key(org_uuid, file_uuid)
            await s3.upload_bytes(
                key=thumb_key,
                data=thumbnail_bytes,
                content_type="image/jpeg",
            )

            stmt = pg_insert(FileMediaInfo).values(
                file_id=file_uuid,
                thumbnail_key=thumb_key,
                thumbnail_width=thumb_width,
                thumbnail_height=thumb_height,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["file_id"],
                set_={
                    "thumbnail_key": stmt.excluded.thumbnail_key,
                    "thumbnail_width": stmt.excluded.thumbnail_width,
                    "thumbnail_height": stmt.excluded.thumbnail_height,
                },
            )
            await session.execute(stmt)

            file.extraction_status = ExtractionStatus.COMPLETED
            await session.commit()

            try:
                await publish_notification(
                    file.owner_id,
                    {
                        "_type": "file_updated",
                        "file_id": str(file.id),
                        "organization_id": str(file.organization_id),
                    },
                )
            except Exception:
                log.warning("Failed to publish file update event")

            log.info("Done")
            return {"status": "success", "thumbnail_key": thumb_key}

        except Exception as e:
            log.error("Failed", error=str(e))

            job_try = ctx.get("job_try", 1)
            if job_try < 3:
                raise Retry(defer=job_try * 10)

            file.extraction_status = ExtractionStatus.FAILED
            error_stmt = pg_insert(FileMediaInfo).values(
                file_id=file_uuid,
                extraction_error=str(e)[:2000],
            )
            error_stmt = error_stmt.on_conflict_do_update(
                index_elements=["file_id"],
                set_={"extraction_error": error_stmt.excluded.extraction_error},
            )
            await session.execute(error_stmt)
            await session.commit()

            return {"status": "failed", "error": str(e)}


def _create_thumbnail(image_bytes: bytes) -> tuple[bytes, int, int]:
    """Resize an image to fit in THUMB_MAX_SIZE; return JPEG bytes + dimensions."""
    with Image.open(io.BytesIO(image_bytes)) as img:
        # Phone cameras carry rotation in EXIF, not in pixels.
        img = ImageOps.exif_transpose(img)

        if img.mode in ("RGBA", "P", "LA", "L"):
            # Flatten transparency onto white before encoding to JPEG.
            if img.mode in ("RGBA", "LA", "P"):
                background = Image.new("RGB", img.size, (255, 255, 255))
                if img.mode == "P":
                    img = img.convert("RGBA")
                background.paste(img, mask=img.split()[-1] if img.mode in ("RGBA", "LA") else None)
                img = background
            else:
                img = img.convert("RGB")

        img.thumbnail(THUMB_MAX_SIZE, Image.Resampling.LANCZOS)

        width, height = img.size

        buffer = io.BytesIO()
        img.save(buffer, format=THUMB_FORMAT, quality=THUMB_QUALITY, optimize=True)
        return buffer.getvalue(), width, height


def _create_pdf_thumbnail(pdf_bytes: bytes) -> tuple[bytes, int, int]:
    """Render the first page of a PDF to a JPEG thumbnail."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = doc[0]

        page_rect = page.rect
        width_ratio = THUMB_MAX_SIZE[0] / page_rect.width
        height_ratio = THUMB_MAX_SIZE[1] / page_rect.height
        zoom = min(width_ratio, height_ratio, 2.0)  # Cap at 2x; beyond that quality flattens.

        mat = fitz.Matrix(zoom, zoom)

        pix = page.get_pixmap(matrix=mat, alpha=False)

        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)

        img.thumbnail(THUMB_MAX_SIZE, Image.Resampling.LANCZOS)

        width, height = img.size

        buffer = io.BytesIO()
        img.save(buffer, format=THUMB_FORMAT, quality=THUMB_QUALITY, optimize=True)
        return buffer.getvalue(), width, height
    finally:
        doc.close()


def _create_video_thumbnail(video_bytes: bytes) -> tuple[bytes, int, int]:
    """Extract a video frame via ffmpeg and encode it as a JPEG thumbnail."""
    # ffmpeg seeking requires a real file, not a stream.
    with tempfile.NamedTemporaryFile(suffix=".video", delete=True) as video_file:
        video_file.write(video_bytes)
        video_file.flush()
        video_path = Path(video_file.name)

        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=True) as output_file:
            output_path = Path(output_file.name)

            cmd = [
                "ffmpeg",
                "-y",
                "-i",
                str(video_path),
                "-ss",
                "1",
                "-vframes",
                "1",
                "-vf",
                f"scale='min({THUMB_MAX_SIZE[0]},iw)':min'({THUMB_MAX_SIZE[1]},ih)'"
                ":force_original_aspect_ratio=decrease",
                "-q:v",
                "2",
                str(output_path),
            ]

            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=30,
            )

            if result.returncode != 0:
                # Seek failed (video shorter than 1s); fall back to the first frame.
                cmd_first_frame = [
                    "ffmpeg",
                    "-y",
                    "-i",
                    str(video_path),
                    "-vframes",
                    "1",
                    "-vf",
                    f"scale='min({THUMB_MAX_SIZE[0]},iw)':min'({THUMB_MAX_SIZE[1]},ih)'"
                    ":force_original_aspect_ratio=decrease",
                    "-q:v",
                    "2",
                    str(output_path),
                ]
                result = subprocess.run(
                    cmd_first_frame,
                    capture_output=True,
                    timeout=30,
                )

                if result.returncode != 0:
                    error_msg = result.stderr.decode("utf-8", errors="replace")
                    raise RuntimeError(f"ffmpeg failed: {error_msg[:500]}")

            frame_bytes = output_path.read_bytes()

            with Image.open(io.BytesIO(frame_bytes)) as img:
                if img.mode != "RGB":
                    img = img.convert("RGB")

                img.thumbnail(THUMB_MAX_SIZE, Image.Resampling.LANCZOS)

                width, height = img.size

                buffer = io.BytesIO()
                img.save(buffer, format=THUMB_FORMAT, quality=THUMB_QUALITY, optimize=True)
                return buffer.getvalue(), width, height
