"""
Metadata extraction tasks.

Extracts metadata from files (EXIF, dimensions, etc.)
and stores it in the file_metadata JSONB field.
"""

import io
from typing import Any
from uuid import UUID

from arq import Retry
from loguru import logger
from PIL import Image
from PIL.ExifTags import TAGS

from uniffy.core.models.files.file import ExtractionStatus, File
from uniffy.core.storage.s3_client import get_s3_client
from uniffy.db.session import get_async_session


async def extract_image_metadata(
    ctx: dict[str, Any],
    file_id: str,
    organization_id: str,
) -> dict[str, Any]:
    """
    Extract metadata from an image file.

    Extracts dimensions, format, color mode, and EXIF data
    from the image and stores it in file_metadata.

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
        Result with status and extracted metadata.

    """
    file_uuid = UUID(file_id)
    s3 = get_s3_client()

    async for session in get_async_session():
        # Fetch file record
        file = await session.get(File, file_uuid)
        if not file:
            logger.warning(f"Extraction: File {file_id} not found")
            return {"status": "not_found", "file_id": file_id}

        # Skip if already completed (thumbnail task may have set COMPLETED)
        if file.extraction_status == ExtractionStatus.COMPLETED:
            logger.debug(f"Extraction: File {file_id} already completed, updating metadata")

        # Update status to PROCESSING if not already completed
        if file.extraction_status != ExtractionStatus.COMPLETED:
            file.extraction_status = ExtractionStatus.PROCESSING
            await session.commit()

        try:
            # Download image from S3
            logger.debug(f"Extraction: Downloading {file.storage_key}")
            image_bytes = await s3.download_bytes(file.storage_key)

            # Extract metadata
            metadata = _extract_image_metadata(image_bytes)

            # Merge with existing metadata (preserve thumbnail_key if set)
            file.file_metadata = file.file_metadata or {}
            file.file_metadata.update(metadata)
            file.extraction_status = ExtractionStatus.COMPLETED
            await session.commit()

            logger.info(f"Extraction: Completed for file {file_id}")
            return {"status": "success", "metadata": metadata}

        except Exception as e:
            logger.error(f"Extraction: Failed for {file_id}: {e}")

            # Retry with backoff for transient errors
            job_try = ctx.get("job_try", 1)
            if job_try < 3:
                raise Retry(defer=job_try * 10)

            # Mark as failed after max retries
            file.extraction_status = ExtractionStatus.FAILED
            file.file_metadata = file.file_metadata or {}
            file.file_metadata["extraction_error"] = str(e)
            await session.commit()

            return {"status": "failed", "error": str(e)}


def _extract_image_metadata(image_bytes: bytes) -> dict[str, Any]:
    """
    Extract metadata from image bytes.

    Parameters
    ----------
    image_bytes : bytes
        Raw image data.

    Returns
    -------
    dict
        Extracted metadata including dimensions, format, and EXIF.

    """
    with Image.open(io.BytesIO(image_bytes)) as img:
        metadata: dict[str, Any] = {
            "width": img.width,
            "height": img.height,
            "format": img.format,
            "mode": img.mode,
        }

        # Extract EXIF data if available
        try:
            exif = img.getexif()
            if exif:
                exif_data: dict[str, Any] = {}
                for tag_id, value in exif.items():
                    tag_name = TAGS.get(tag_id, str(tag_id))
                    # Skip binary data and complex objects
                    if isinstance(value, bytes):
                        continue
                    # Convert to string for JSON serialization
                    try:
                        if isinstance(value, (int, float, str)):
                            exif_data[tag_name] = value
                        else:
                            exif_data[tag_name] = str(value)
                    except Exception:
                        continue
                if exif_data:
                    metadata["exif"] = exif_data
        except Exception as e:
            logger.debug(f"Could not extract EXIF: {e}")

        return metadata
