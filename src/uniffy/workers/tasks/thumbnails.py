"""
Thumbnail generation tasks.

Generates thumbnails for images, PDFs, and videos, storing them in S3
with a consistent key pattern for easy retrieval.
"""

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
from uniffy.db.session import get_async_session

# Thumbnail configuration
THUMB_MAX_SIZE = (400, 400)  # Max dimensions (maintains aspect ratio)
THUMB_QUALITY = 85  # JPEG quality (1-100)
THUMB_FORMAT = "JPEG"


def get_thumbnail_key(organization_id: UUID, file_id: UUID) -> str:
    """
    Generate S3 key for thumbnail.

    Pattern: {org_id}/thumbnails/{file_id}.jpg

    Parameters
    ----------
    organization_id : UUID
        Organization ID for multi-tenant isolation.
    file_id : UUID
        File UUID.

    Returns
    -------
    str
        S3 object key for the thumbnail.

    """
    return f"{organization_id}/thumbnails/{file_id}.jpg"


async def generate_image_thumbnail(
    ctx: dict[str, Any],
    file_id: str,
    organization_id: str,
) -> dict[str, Any]:
    """
    Generate thumbnail for an image file.

    Downloads the original image from S3, creates a thumbnail
    using Pillow, and uploads it back to S3. Updates the file
    record with the thumbnail key.

    Parameters
    ----------
    ctx : dict
        ARQ context with shared resources and job metadata.
    file_id : str
        File UUID as string.
    organization_id : str
        Organization UUID as string.

    Returns
    -------
    dict
        Result with status and thumbnail_key if successful.

    """
    log = logger.bind(task="thumbnail", kind="image", file_id=file_id)
    log.info("Started")

    file_uuid = UUID(file_id)
    org_uuid = UUID(organization_id)

    s3 = get_s3_client()

    async for session in get_async_session():
        # Fetch file record
        file = await session.get(File, file_uuid)
        if not file:
            log.warning("File not found")
            return {"status": "not_found", "file_id": file_id}

        # Update status to PROCESSING
        file.extraction_status = ExtractionStatus.PROCESSING
        await session.commit()

        try:
            # Download original image from S3
            image_bytes = await s3.download_bytes(file.storage_key)
            log.info("Downloaded image", bytes=len(image_bytes))

            # Generate thumbnail
            thumbnail_bytes, thumb_width, thumb_height = _create_thumbnail(image_bytes)
            log.info(
                "Generated thumbnail",
                thumb_bytes=len(thumbnail_bytes),
                thumb_width=thumb_width,
                thumb_height=thumb_height,
            )

            # Upload thumbnail to S3
            thumb_key = get_thumbnail_key(org_uuid, file_uuid)
            await s3.upload_bytes(
                key=thumb_key,
                data=thumbnail_bytes,
                content_type="image/jpeg",
            )

            # UPSERT only thumbnail columns into FileMediaInfo
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
                await publish_notification(file.owner_id, {
                    "_type": "file_updated",
                    "file_id": str(file.id),
                    "organization_id": str(file.organization_id),
                })
            except Exception:
                log.warning("Failed to publish file update event")

            log.info("Done")
            return {"status": "success", "thumbnail_key": thumb_key}

        except Exception as e:
            log.error("Failed", error=str(e))

            # Retry with backoff for transient errors
            job_try = ctx.get("job_try", 1)
            if job_try < 3:
                raise Retry(defer=job_try * 10)

            # Mark as failed after max retries
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
    """
    Generate thumbnail for a PDF file.

    Renders the first page of the PDF using PyMuPDF,
    converts to image, and uploads to S3.

    Parameters
    ----------
    ctx : dict
        ARQ context with shared resources and job metadata.
    file_id : str
        File UUID as string.
    organization_id : str
        Organization UUID as string.

    Returns
    -------
    dict
        Result with status and thumbnail_key if successful.

    """
    log = logger.bind(task="thumbnail", kind="pdf", file_id=file_id)
    log.info("Started")

    file_uuid = UUID(file_id)
    org_uuid = UUID(organization_id)

    s3 = get_s3_client()

    async for session in get_async_session():
        # Fetch file record
        file = await session.get(File, file_uuid)
        if not file:
            log.warning("File not found")
            return {"status": "not_found", "file_id": file_id}

        # Update status to PROCESSING
        file.extraction_status = ExtractionStatus.PROCESSING
        await session.commit()

        try:
            # Download PDF from S3
            pdf_bytes = await s3.download_bytes(file.storage_key)
            log.info("Downloaded PDF", bytes=len(pdf_bytes))

            # Generate thumbnail from first page
            thumbnail_bytes, thumb_width, thumb_height = _create_pdf_thumbnail(pdf_bytes)

            # Upload thumbnail to S3
            thumb_key = get_thumbnail_key(org_uuid, file_uuid)
            await s3.upload_bytes(
                key=thumb_key,
                data=thumbnail_bytes,
                content_type="image/jpeg",
            )

            # UPSERT only thumbnail columns into FileMediaInfo
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
                await publish_notification(file.owner_id, {
                    "_type": "file_updated",
                    "file_id": str(file.id),
                    "organization_id": str(file.organization_id),
                })
            except Exception:
                log.warning("Failed to publish file update event")

            log.info("Done")
            return {"status": "success", "thumbnail_key": thumb_key}

        except Exception as e:
            log.error("Failed", error=str(e))

            # Retry with backoff for transient errors
            job_try = ctx.get("job_try", 1)
            if job_try < 3:
                raise Retry(defer=job_try * 10)

            # Mark as failed after max retries
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
    """
    Generate thumbnail for a video file.

    Extracts a frame from the video using ffmpeg,
    converts to JPEG, and uploads to S3.

    Parameters
    ----------
    ctx : dict
        ARQ context with shared resources and job metadata.
    file_id : str
        File UUID as string.
    organization_id : str
        Organization UUID as string.

    Returns
    -------
    dict
        Result with status and thumbnail_key if successful.

    """
    log = logger.bind(task="thumbnail", kind="video", file_id=file_id)
    log.info("Started")

    file_uuid = UUID(file_id)
    org_uuid = UUID(organization_id)

    s3 = get_s3_client()

    async for session in get_async_session():
        # Fetch file record
        file = await session.get(File, file_uuid)
        if not file:
            log.warning("File not found")
            return {"status": "not_found", "file_id": file_id}

        # Update status to PROCESSING
        file.extraction_status = ExtractionStatus.PROCESSING
        await session.commit()

        try:
            # Download video from S3
            video_bytes = await s3.download_bytes(file.storage_key)
            log.info("Downloaded video", bytes=len(video_bytes))

            # Generate thumbnail from video frame
            thumbnail_bytes, thumb_width, thumb_height = _create_video_thumbnail(video_bytes)

            # Upload thumbnail to S3
            thumb_key = get_thumbnail_key(org_uuid, file_uuid)
            await s3.upload_bytes(
                key=thumb_key,
                data=thumbnail_bytes,
                content_type="image/jpeg",
            )

            # UPSERT only thumbnail columns into FileMediaInfo
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
                await publish_notification(file.owner_id, {
                    "_type": "file_updated",
                    "file_id": str(file.id),
                    "organization_id": str(file.organization_id),
                })
            except Exception:
                log.warning("Failed to publish file update event")

            log.info("Done")
            return {"status": "success", "thumbnail_key": thumb_key}

        except Exception as e:
            log.error("Failed", error=str(e))

            # Retry with backoff for transient errors
            job_try = ctx.get("job_try", 1)
            if job_try < 3:
                raise Retry(defer=job_try * 10)

            # Mark as failed after max retries
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
    """
    Create a thumbnail from image bytes.

    Opens the image, converts to RGB if needed, creates
    a thumbnail maintaining aspect ratio, and returns
    the compressed JPEG bytes along with dimensions.

    Parameters
    ----------
    image_bytes : bytes
        Original image data.

    Returns
    -------
    tuple[bytes, int, int]
        Thumbnail image as JPEG bytes, width, and height.

    """
    with Image.open(io.BytesIO(image_bytes)) as img:
        # Apply EXIF orientation (phone cameras store rotation in EXIF metadata)
        img = ImageOps.exif_transpose(img)

        # Convert to RGB if necessary (handles RGBA, P, LA, etc.)
        if img.mode in ("RGBA", "P", "LA", "L"):
            # Create white background for transparency
            if img.mode in ("RGBA", "LA", "P"):
                background = Image.new("RGB", img.size, (255, 255, 255))
                if img.mode == "P":
                    img = img.convert("RGBA")
                background.paste(img, mask=img.split()[-1] if img.mode in ("RGBA", "LA") else None)
                img = background
            else:
                img = img.convert("RGB")

        # Create thumbnail maintaining aspect ratio
        img.thumbnail(THUMB_MAX_SIZE, Image.Resampling.LANCZOS)

        # Get final dimensions
        width, height = img.size

        # Save to bytes buffer
        buffer = io.BytesIO()
        img.save(buffer, format=THUMB_FORMAT, quality=THUMB_QUALITY, optimize=True)
        return buffer.getvalue(), width, height


def _create_pdf_thumbnail(pdf_bytes: bytes) -> tuple[bytes, int, int]:
    """
    Create a thumbnail from PDF bytes.

    Renders the first page of the PDF using PyMuPDF,
    scales it to fit within THUMB_MAX_SIZE, and returns
    the compressed JPEG bytes along with dimensions.

    Parameters
    ----------
    pdf_bytes : bytes
        PDF file data.

    Returns
    -------
    tuple[bytes, int, int]
        Thumbnail image as JPEG bytes, width, and height.

    """
    # Open PDF from bytes
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        # Get first page
        page = doc[0]

        # Calculate zoom factor to fit within THUMB_MAX_SIZE
        # while maintaining aspect ratio
        page_rect = page.rect
        width_ratio = THUMB_MAX_SIZE[0] / page_rect.width
        height_ratio = THUMB_MAX_SIZE[1] / page_rect.height
        zoom = min(width_ratio, height_ratio, 2.0)  # Cap at 2x for quality

        # Create transformation matrix for rendering
        mat = fitz.Matrix(zoom, zoom)

        # Render page to pixmap (image)
        pix = page.get_pixmap(matrix=mat, alpha=False)

        # Convert to PIL Image
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)

        # Create thumbnail maintaining aspect ratio
        img.thumbnail(THUMB_MAX_SIZE, Image.Resampling.LANCZOS)

        # Get final dimensions
        width, height = img.size

        # Save to bytes buffer
        buffer = io.BytesIO()
        img.save(buffer, format=THUMB_FORMAT, quality=THUMB_QUALITY, optimize=True)
        return buffer.getvalue(), width, height
    finally:
        doc.close()


def _create_video_thumbnail(video_bytes: bytes) -> tuple[bytes, int, int]:
    """
    Create a thumbnail from video bytes.

    Extracts a frame from the video using ffmpeg,
    scales it to fit within THUMB_MAX_SIZE, and returns
    the compressed JPEG bytes along with dimensions.

    Parameters
    ----------
    video_bytes : bytes
        Video file data.

    Returns
    -------
    tuple[bytes, int, int]
        Thumbnail image as JPEG bytes, width, and height.

    Raises
    ------
    RuntimeError
        If ffmpeg fails to extract a frame.

    """
    # Write video to temp file (ffmpeg needs file input for seeking)
    with tempfile.NamedTemporaryFile(suffix=".video", delete=True) as video_file:
        video_file.write(video_bytes)
        video_file.flush()
        video_path = Path(video_file.name)

        # Output temp file for the frame
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=True) as output_file:
            output_path = Path(output_file.name)

            # Extract frame at 1 second (or first frame if video is shorter)
            # Using subprocess directly for better control over ffmpeg
            cmd = [
                "ffmpeg",
                "-y",  # Overwrite output
                "-i", str(video_path),
                "-ss", "1",  # Seek to 1 second
                "-vframes", "1",  # Extract 1 frame
                "-vf", f"scale='min({THUMB_MAX_SIZE[0]},iw)':min'({THUMB_MAX_SIZE[1]},ih)'"
                       ":force_original_aspect_ratio=decrease",
                "-q:v", "2",  # High quality JPEG
                str(output_path),
            ]

            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=30,  # 30 second timeout
            )

            if result.returncode != 0:
                # Try extracting first frame if seeking failed
                cmd_first_frame = [
                    "ffmpeg",
                    "-y",
                    "-i", str(video_path),
                    "-vframes", "1",
                    "-vf", f"scale='min({THUMB_MAX_SIZE[0]},iw)':min'({THUMB_MAX_SIZE[1]},ih)'"
                           ":force_original_aspect_ratio=decrease",
                    "-q:v", "2",
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

            # Read the output frame
            frame_bytes = output_path.read_bytes()

            # Open with PIL to get dimensions and ensure proper format
            with Image.open(io.BytesIO(frame_bytes)) as img:
                # Ensure RGB mode
                if img.mode != "RGB":
                    img = img.convert("RGB")

                # Apply final thumbnail sizing
                img.thumbnail(THUMB_MAX_SIZE, Image.Resampling.LANCZOS)

                width, height = img.size

                # Save to bytes buffer
                buffer = io.BytesIO()
                img.save(buffer, format=THUMB_FORMAT, quality=THUMB_QUALITY, optimize=True)
                return buffer.getvalue(), width, height
