"""Generate JPEG thumbnails for images, PDFs, and videos; upload to S3."""

import io
from typing import Any, cast
from uuid import UUID

from loguru import logger
from PIL import Image, ImageOps
from sqlalchemy.dialects.postgresql import insert as pg_insert

from uniffy.core.events.realtime import NotificationPayloadType, publish_notification
from uniffy.core.extraction.pdf import render_pdf_page
from uniffy.core.models.files.file import File, ThumbnailStatus
from uniffy.core.models.files.media_info import FileMediaInfo
from uniffy.core.storage import OBJECT_STORAGE_CTX_KEY, ObjectStorage
from uniffy.domains.files.jobs.media import probe, run_media, thumbnail_args
from uniffy.domains.files.jobs.settings import MEDIA_SETTINGS
from uniffy.domains.files.jobs.source import MEDIA_SOURCE_CTX_KEY, MediaSourceServer
from uniffy.infrastructure.database.session import open_session
from uniffy.vendor.arq import Retry

logger = logger.bind(component="files.jobs.thumbnails")

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

    storage = cast(ObjectStorage, ctx[OBJECT_STORAGE_CTX_KEY])

    async with open_session() as session:
        file = await session.get(File, file_uuid)
        if not file:
            log.warning("File not found")
            return {"status": "not_found", "file_id": file_id}

        if file.thumbnail_status in (ThumbnailStatus.COMPLETED, ThumbnailStatus.SKIPPED):
            return {"status": "skipped", "reason": "terminal_status", "file_id": file_id}

        file.thumbnail_status = ThumbnailStatus.PROCESSING
        await session.commit()

        try:
            image_bytes = await storage.download_bytes(file.storage_key)
            log.info("Downloaded image", bytes=len(image_bytes))

            thumbnail_bytes, thumb_width, thumb_height = _create_thumbnail(image_bytes)
            log.info(
                "Generated thumbnail",
                thumb_bytes=len(thumbnail_bytes),
                thumb_width=thumb_width,
                thumb_height=thumb_height,
            )

            thumb_key = get_thumbnail_key(org_uuid, file_uuid)
            await storage.upload_bytes(
                key=thumb_key,
                data=thumbnail_bytes,
                content_type="image/jpeg",
            )

            stmt = pg_insert(FileMediaInfo).values(
                file_id=file_uuid,
                thumbnail_key=thumb_key,
                thumbnail_width=thumb_width,
                thumbnail_height=thumb_height,
                thumbnail_error=None,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["file_id"],
                set_={
                    "thumbnail_key": stmt.excluded.thumbnail_key,
                    "thumbnail_width": stmt.excluded.thumbnail_width,
                    "thumbnail_height": stmt.excluded.thumbnail_height,
                    "thumbnail_error": stmt.excluded.thumbnail_error,
                },
            )
            await session.execute(stmt)

            file.thumbnail_status = ThumbnailStatus.COMPLETED
            await session.commit()

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

            log.info("Done")
            return {"status": "success", "thumbnail_key": thumb_key}

        except Exception as e:
            log.error("Failed", error=str(e))

            job_try = ctx.get("job_try", 1)
            if job_try < 3:
                raise Retry(defer=job_try * 10)

            file.thumbnail_status = ThumbnailStatus.FAILED
            error_stmt = pg_insert(FileMediaInfo).values(
                file_id=file_uuid,
                thumbnail_error=str(e)[:2000],
            )
            error_stmt = error_stmt.on_conflict_do_update(
                index_elements=["file_id"],
                set_={"thumbnail_error": error_stmt.excluded.thumbnail_error},
            )
            await session.execute(error_stmt)
            await session.commit()

            return {"status": "failed", "error": str(e)}


async def generate_pdf_thumbnail(
    ctx: dict[str, Any],
    file_id: str,
    organization_id: str,
) -> dict[str, Any]:
    """Render the first PDF page within the thumbnail size budget."""
    log = logger.bind(task="thumbnail", kind="pdf", file_id=file_id)
    log.info("Started")

    file_uuid = UUID(file_id)
    org_uuid = UUID(organization_id)

    storage = cast(ObjectStorage, ctx[OBJECT_STORAGE_CTX_KEY])

    async with open_session() as session:
        file = await session.get(File, file_uuid)
        if not file:
            log.warning("File not found")
            return {"status": "not_found", "file_id": file_id}

        if file.thumbnail_status in (ThumbnailStatus.COMPLETED, ThumbnailStatus.SKIPPED):
            return {"status": "skipped", "reason": "terminal_status", "file_id": file_id}

        file.thumbnail_status = ThumbnailStatus.PROCESSING
        await session.commit()

        try:
            pdf_bytes = await storage.download_bytes(file.storage_key)
            log.info("Downloaded PDF", bytes=len(pdf_bytes))

            thumbnail_bytes, thumb_width, thumb_height = _create_pdf_thumbnail(pdf_bytes)

            thumb_key = get_thumbnail_key(org_uuid, file_uuid)
            await storage.upload_bytes(
                key=thumb_key,
                data=thumbnail_bytes,
                content_type="image/jpeg",
            )

            stmt = pg_insert(FileMediaInfo).values(
                file_id=file_uuid,
                thumbnail_key=thumb_key,
                thumbnail_width=thumb_width,
                thumbnail_height=thumb_height,
                thumbnail_error=None,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["file_id"],
                set_={
                    "thumbnail_key": stmt.excluded.thumbnail_key,
                    "thumbnail_width": stmt.excluded.thumbnail_width,
                    "thumbnail_height": stmt.excluded.thumbnail_height,
                    "thumbnail_error": stmt.excluded.thumbnail_error,
                },
            )
            await session.execute(stmt)

            file.thumbnail_status = ThumbnailStatus.COMPLETED
            await session.commit()

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

            log.info("Done")
            return {"status": "success", "thumbnail_key": thumb_key}

        except Exception as e:
            log.error("Failed", error=str(e))

            job_try = ctx.get("job_try", 1)
            if job_try < 3:
                raise Retry(defer=job_try * 10)

            file.thumbnail_status = ThumbnailStatus.FAILED
            error_stmt = pg_insert(FileMediaInfo).values(
                file_id=file_uuid,
                thumbnail_error=str(e)[:2000],
            )
            error_stmt = error_stmt.on_conflict_do_update(
                index_elements=["file_id"],
                set_={"thumbnail_error": error_stmt.excluded.thumbnail_error},
            )
            await session.execute(error_stmt)
            await session.commit()

            return {"status": "failed", "error": str(e)}


async def generate_video_thumbnail(
    ctx: dict[str, Any],
    file_id: str,
    organization_id: str,
) -> dict[str, Any]:
    """Decode a bounded frame outside the worker process."""
    log = logger.bind(task="thumbnail", kind="video", file_id=file_id)
    log.info("Started")

    file_uuid = UUID(file_id)
    org_uuid = UUID(organization_id)

    storage = cast(ObjectStorage, ctx[OBJECT_STORAGE_CTX_KEY])

    async with open_session() as session:
        file = await session.get(File, file_uuid)
        if not file:
            log.warning("File not found")
            return {"status": "not_found", "file_id": file_id}

        if file.thumbnail_status in (ThumbnailStatus.COMPLETED, ThumbnailStatus.SKIPPED):
            return {"status": "skipped", "reason": "terminal_status", "file_id": file_id}

        file.thumbnail_status = ThumbnailStatus.PROCESSING
        await session.commit()

        try:
            sources = cast(MediaSourceServer, ctx[MEDIA_SOURCE_CTX_KEY])
            async with sources.open(file.storage_key, MEDIA_SETTINGS.max_source_bytes) as source:
                info = await probe(source)
                frame = await run_media("ffmpeg", thumbnail_args(source, info), 60)
                thumbnail_bytes, thumb_width, thumb_height = _create_thumbnail(frame)

            thumb_key = get_thumbnail_key(org_uuid, file_uuid)
            await storage.upload_bytes(
                key=thumb_key,
                data=thumbnail_bytes,
                content_type="image/jpeg",
            )

            stmt = pg_insert(FileMediaInfo).values(
                file_id=file_uuid,
                thumbnail_key=thumb_key,
                thumbnail_width=thumb_width,
                thumbnail_height=thumb_height,
                thumbnail_error=None,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["file_id"],
                set_={
                    "thumbnail_key": stmt.excluded.thumbnail_key,
                    "thumbnail_width": stmt.excluded.thumbnail_width,
                    "thumbnail_height": stmt.excluded.thumbnail_height,
                    "thumbnail_error": stmt.excluded.thumbnail_error,
                },
            )
            await session.execute(stmt)

            file.thumbnail_status = ThumbnailStatus.COMPLETED
            await session.commit()

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

            log.info("Done")
            return {"status": "success", "thumbnail_key": thumb_key}

        except Exception as e:
            log.error("Failed", error=str(e))

            job_try = ctx.get("job_try", 1)
            if job_try < 3:
                raise Retry(defer=job_try * 10)

            file.thumbnail_status = ThumbnailStatus.FAILED
            error_stmt = pg_insert(FileMediaInfo).values(
                file_id=file_uuid,
                thumbnail_error=str(e)[:2000],
            )
            error_stmt = error_stmt.on_conflict_do_update(
                index_elements=["file_id"],
                set_={"thumbnail_error": error_stmt.excluded.thumbnail_error},
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
                if img.mode == "P":  # noqa: PLR2004
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
    return _create_thumbnail(render_pdf_page(pdf_bytes, THUMB_MAX_SIZE))
