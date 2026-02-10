"""
Metadata extraction tasks.

Extracts metadata from files (EXIF, dimensions, etc.)
and UPSERTs it into the files_media_info table.
"""

import base64
import io
from typing import Any
from uuid import UUID

import mutagen
from arq import Retry
from loguru import logger
from PIL import Image
from PIL.ExifTags import GPSTAGS, IFD, TAGS
from sqlalchemy.dialects.postgresql import insert as pg_insert

from uniffy.core.models.files.file import ExtractionStatus, File
from uniffy.core.models.files.media_info import FileMediaInfo
from uniffy.core.storage.s3_client import get_s3_client
from uniffy.core.valkey import publish_notification
from uniffy.db.session import get_async_session
from uniffy.workers.tasks.thumbnails import _create_thumbnail, get_thumbnail_key

_task = "extraction"


async def extract_image_metadata(
    ctx: dict[str, Any],
    file_id: str,
    organization_id: str,
) -> dict[str, Any]:
    """
    Extract metadata from an image file.

    Extracts dimensions, format, color mode, and EXIF data
    from the image and UPSERTs it into files_media_info.

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
    log = logger.bind(task=_task, file_id=file_id)
    log.info("Started")

    file_uuid = UUID(file_id)
    s3 = get_s3_client()

    async for session in get_async_session():
        # Fetch file record
        file = await session.get(File, file_uuid)
        if not file:
            log.warning("File not found")
            return {"status": "not_found", "file_id": file_id}

        # Update status to PROCESSING if not already completed
        if file.extraction_status != ExtractionStatus.COMPLETED:
            file.extraction_status = ExtractionStatus.PROCESSING
            await session.commit()

        try:
            # Download image from S3
            image_bytes = await s3.download_bytes(file.storage_key)
            log.info(f"downloaded image bytes: {len(image_bytes)}")

            # Extract metadata
            metadata = _extract_image_metadata(image_bytes)
            log.info(
                "Extracted metadata",
            )

            # UPSERT only extraction columns into FileMediaInfo
            stmt = pg_insert(FileMediaInfo).values(
                file_id=file_uuid,
                width=metadata.get("width"),
                height=metadata.get("height"),
                format=metadata.get("format"),
                color_mode=metadata.get("mode"),
                exif=metadata.get("exif"),
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["file_id"],
                set_={
                    "width": stmt.excluded.width,
                    "height": stmt.excluded.height,
                    "format": stmt.excluded.format,
                    "color_mode": stmt.excluded.color_mode,
                    "exif": stmt.excluded.exif,
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
            return {"status": "success", "metadata": metadata}

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

                # IFD0 tags (basic: Make, Model, Orientation, etc.)
                for tag_id, value in exif.items():
                    tag_name = TAGS.get(tag_id, str(tag_id))
                    _add_exif_value(exif_data, tag_name, value)

                # EXIF IFD sub-tags (camera settings: ISO, aperture, shutter, etc.)
                try:
                    exif_ifd = exif.get_ifd(IFD.Exif)
                    for tag_id, value in exif_ifd.items():
                        tag_name = TAGS.get(tag_id, str(tag_id))
                        _add_exif_value(exif_data, tag_name, value)
                except Exception:
                    pass

                # GPS IFD sub-tags
                try:
                    gps_ifd = exif.get_ifd(IFD.GPSInfo)
                    for tag_id, value in gps_ifd.items():
                        tag_name = GPSTAGS.get(tag_id, str(tag_id))
                        _add_exif_value(exif_data, f"GPS{tag_name}", value)
                except Exception:
                    pass

                if exif_data:
                    metadata["exif"] = exif_data
        except Exception as e:
            logger.debug(f"Could not extract EXIF: {e}")

        return metadata


def _add_exif_value(
    exif_data: dict[str, Any],
    tag_name: str,
    value: Any,
) -> None:
    """
    Add a single EXIF value to the dict, skipping binary data.

    Parameters
    ----------
    exif_data : dict
        Target dictionary to add the value to.
    tag_name : str
        Human-readable EXIF tag name.
    value : Any
        Raw EXIF value from Pillow.

    """
    if isinstance(value, bytes):
        return
    try:
        if isinstance(value, (int, float, str)):
            exif_data[tag_name] = value
        elif isinstance(value, tuple):
            exif_data[tag_name] = ", ".join(str(v) for v in value)
        else:
            exif_data[tag_name] = str(value)
    except Exception:
        return


async def extract_audio_metadata(
    ctx: dict[str, Any],
    file_id: str,
    organization_id: str,
) -> dict[str, Any]:
    """
    Extract metadata and album art from an audio file.

    Uses mutagen to extract duration, bitrate, sample rate, and channels.
    If embedded album art is found, generates a thumbnail and uploads to S3.

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
    log = logger.bind(task="audio_extraction", file_id=file_id)
    log.info("Started")

    file_uuid = UUID(file_id)
    org_uuid = UUID(organization_id)
    s3 = get_s3_client()

    async for session in get_async_session():
        file = await session.get(File, file_uuid)
        if not file:
            log.warning("File not found")
            return {"status": "not_found", "file_id": file_id}

        if file.extraction_status != ExtractionStatus.COMPLETED:
            file.extraction_status = ExtractionStatus.PROCESSING
            await session.commit()

        try:
            audio_bytes = await s3.download_bytes(file.storage_key)
            log.info("Downloaded audio", bytes=len(audio_bytes))

            # Extract metadata with mutagen
            audio = mutagen.File(io.BytesIO(audio_bytes))
            if audio is None:
                log.warning("Mutagen could not parse audio file")
                file.extraction_status = ExtractionStatus.SKIPPED
                await session.commit()
                return {"status": "skipped", "file_id": file_id}

            metadata: dict[str, Any] = {}
            info = audio.info
            if hasattr(info, "length") and info.length:
                metadata["duration_seconds"] = float(info.length)
            if hasattr(info, "bitrate") and info.bitrate:
                metadata["bitrate"] = int(info.bitrate)
            if hasattr(info, "sample_rate") and info.sample_rate:
                metadata["sample_rate"] = int(info.sample_rate)
            if hasattr(info, "channels") and info.channels:
                metadata["channels"] = int(info.channels)

            log.info("Extracted audio metadata", **metadata)

            # Try to extract embedded album art
            album_art_bytes = _extract_album_art(audio)

            # Build UPSERT values
            upsert_values: dict[str, Any] = {"file_id": file_uuid}
            update_set: dict[str, Any] = {}

            if "duration_seconds" in metadata:
                upsert_values["duration_seconds"] = metadata["duration_seconds"]
            if "bitrate" in metadata:
                upsert_values["bitrate"] = metadata["bitrate"]
            if "sample_rate" in metadata:
                upsert_values["sample_rate"] = metadata["sample_rate"]
            if "channels" in metadata:
                upsert_values["channels"] = metadata["channels"]

            # Generate thumbnail from album art if found
            if album_art_bytes:
                try:
                    thumb_bytes, thumb_w, thumb_h = _create_thumbnail(album_art_bytes)
                    thumb_key = get_thumbnail_key(org_uuid, file_uuid)
                    await s3.upload_bytes(
                        key=thumb_key,
                        data=thumb_bytes,
                        content_type="image/jpeg",
                    )
                    upsert_values["thumbnail_key"] = thumb_key
                    upsert_values["thumbnail_width"] = thumb_w
                    upsert_values["thumbnail_height"] = thumb_h
                    log.info("Generated album art thumbnail")
                except Exception as e:
                    log.exception("Failed to generate album art thumbnail", error=str(e))

            stmt = pg_insert(FileMediaInfo).values(**upsert_values)

            # Build update set from all non-file_id values
            for key in upsert_values:
                if key != "file_id":
                    update_set[key] = getattr(stmt.excluded, key)

            if update_set:
                stmt = stmt.on_conflict_do_update(
                    index_elements=["file_id"],
                    set_=update_set,
                )
            else:
                stmt = stmt.on_conflict_do_nothing(index_elements=["file_id"])

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
            return {"status": "success", "metadata": metadata}

        except Exception as e:
            log.exception("task failed", error=str(e))

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


def _extract_album_art(audio: mutagen.FileType) -> bytes | None:
    """
    Extract embedded album art from an audio file.

    Supports ID3 (MP3), Vorbis/FLAC (METADATA_BLOCK_PICTURE),
    and MP4/M4A (covr) cover art formats.

    Parameters
    ----------
    audio : mutagen.FileType
        Parsed mutagen audio file.

    Returns
    -------
    bytes | None
        Album art image bytes, or None if not found.

    """
    # ID3 tags (MP3): APIC frames
    if hasattr(audio, "tags") and audio.tags:
        tags = audio.tags

        # ID3 APIC (MP3)
        for key in tags:
            if key.startswith("APIC"):
                frame = tags[key]
                if hasattr(frame, "data") and frame.data:
                    return frame.data

        # MP4/M4A: covr
        if "covr" in tags:
            covers = tags["covr"]
            if covers and len(covers) > 0:
                cover = covers[0]
                if isinstance(cover, bytes):
                    return cover
                if hasattr(cover, "data"):
                    return bytes(cover)
                return bytes(cover)

    # Vorbis/FLAC: METADATA_BLOCK_PICTURE or pictures attribute
    if hasattr(audio, "pictures") and audio.pictures:
        pic = audio.pictures[0]
        if hasattr(pic, "data") and pic.data:
            return pic.data

    # Vorbis comments with base64-encoded METADATA_BLOCK_PICTURE
    if hasattr(audio, "tags") and audio.tags and "metadata_block_picture" in audio.tags:
        pictures = audio.tags["metadata_block_picture"]
        if pictures:
            try:
                from mutagen.flac import Picture

                pic_data = base64.b64decode(pictures[0])
                pic = Picture(pic_data)
                if pic.data:
                    return pic.data
            except Exception:
                pass

    return None
