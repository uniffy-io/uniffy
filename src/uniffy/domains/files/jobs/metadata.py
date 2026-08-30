"""Image + audio metadata extraction tasks; UPSERT into `files_media_info`."""

import base64
import io
from typing import Any, cast
from uuid import UUID

import mutagen
from loguru import logger
from PIL import Image
from PIL.ExifTags import GPSTAGS, IFD, TAGS
from sqlalchemy.dialects.postgresql import insert as pg_insert

from uniffy.core.models.files.file import ExtractionStatus, File
from uniffy.core.models.files.media_info import FileMediaInfo
from uniffy.core.storage import OBJECT_STORAGE_CTX_KEY, ObjectStorage
from uniffy.core.valkey import NotificationPayloadType, publish_notification
from uniffy.domains.files.jobs.thumbnails import _create_thumbnail, get_thumbnail_key
from uniffy.infrastructure.database.session import open_session
from uniffy.vendor.arq import Retry

logger = logger.bind(component="files.jobs.metadata")

_task = "extraction"


async def extract_image_metadata(
    ctx: dict[str, Any],
    file_id: str,
    organization_id: str,
) -> dict[str, Any]:
    """Extract dimensions, format, mode, and EXIF from an image."""
    log = logger.bind(task=_task, file_id=file_id)
    log.info("Started")

    file_uuid = UUID(file_id)
    storage = cast(ObjectStorage, ctx[OBJECT_STORAGE_CTX_KEY])

    async with open_session() as session:
        file = await session.get(File, file_uuid)
        if not file:
            log.warning("File not found")
            return {"status": "not_found", "file_id": file_id}

        if file.extraction_status in (ExtractionStatus.COMPLETED, ExtractionStatus.SKIPPED):
            return {"status": "skipped", "reason": "terminal_status", "file_id": file_id}

        file.extraction_status = ExtractionStatus.PROCESSING
        await session.commit()

        try:
            image_bytes = await storage.download_bytes(file.storage_key)
            log.info(f"downloaded image bytes: {len(image_bytes)}")

            metadata = _extract_image_metadata(image_bytes)
            log.info("Extracted metadata")

            stmt = pg_insert(FileMediaInfo).values(
                file_id=file_uuid,
                width=metadata.get("width"),
                height=metadata.get("height"),
                format=metadata.get("format"),
                color_mode=metadata.get("mode"),
                exif=metadata.get("exif"),
                extraction_error=None,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["file_id"],
                set_={
                    "width": stmt.excluded.width,
                    "height": stmt.excluded.height,
                    "format": stmt.excluded.format,
                    "color_mode": stmt.excluded.color_mode,
                    "exif": stmt.excluded.exif,
                    "extraction_error": stmt.excluded.extraction_error,
                },
            )
            await session.execute(stmt)

            file.extraction_status = ExtractionStatus.COMPLETED
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
            return {"status": "success", "metadata": metadata}

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


def _extract_image_metadata(image_bytes: bytes) -> dict[str, Any]:
    with Image.open(io.BytesIO(image_bytes)) as img:
        metadata: dict[str, Any] = {
            "width": img.width,
            "height": img.height,
            "format": img.format,
            "mode": img.mode,
        }

        try:
            exif = img.getexif()
            if exif:
                exif_data: dict[str, Any] = {}

                for tag_id, value in exif.items():
                    tag_name = TAGS.get(tag_id, str(tag_id))
                    _add_exif_value(exif_data, tag_name, value)

                try:
                    exif_ifd = exif.get_ifd(IFD.Exif)
                    for tag_id, value in exif_ifd.items():
                        tag_name = TAGS.get(tag_id, str(tag_id))
                        _add_exif_value(exif_data, tag_name, value)
                except Exception:
                    pass

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
    """Coerce an EXIF value into JSON-serialisable form; drop raw bytes."""
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
    """Extract audio info via mutagen; if album art is embedded, derive a thumbnail."""
    log = logger.bind(task="audio_extraction", file_id=file_id)
    log.info("Started")

    file_uuid = UUID(file_id)
    org_uuid = UUID(organization_id)
    storage = cast(ObjectStorage, ctx[OBJECT_STORAGE_CTX_KEY])

    async with open_session() as session:
        file = await session.get(File, file_uuid)
        if not file:
            log.warning("File not found")
            return {"status": "not_found", "file_id": file_id}

        if file.extraction_status in (ExtractionStatus.COMPLETED, ExtractionStatus.SKIPPED):
            return {"status": "skipped", "reason": "terminal_status", "file_id": file_id}

        file.extraction_status = ExtractionStatus.PROCESSING
        await session.commit()

        try:
            audio_bytes = await storage.download_bytes(file.storage_key)
            log.info("Downloaded audio", bytes=len(audio_bytes))

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

            album_art_bytes = _extract_album_art(audio)

            upsert_values: dict[str, Any] = {
                "file_id": file_uuid,
                "extraction_error": None,
            }
            update_set: dict[str, Any] = {
                "extraction_error": pg_insert(FileMediaInfo).excluded.extraction_error,
            }

            if "duration_seconds" in metadata:  # noqa: PLR2004
                upsert_values["duration_seconds"] = metadata["duration_seconds"]
            if "bitrate" in metadata:  # noqa: PLR2004
                upsert_values["bitrate"] = metadata["bitrate"]
            if "sample_rate" in metadata:  # noqa: PLR2004
                upsert_values["sample_rate"] = metadata["sample_rate"]
            if "channels" in metadata:  # noqa: PLR2004
                upsert_values["channels"] = metadata["channels"]

            if album_art_bytes:
                try:
                    thumb_bytes, thumb_w, thumb_h = _create_thumbnail(album_art_bytes)
                    thumb_key = get_thumbnail_key(org_uuid, file_uuid)
                    await storage.upload_bytes(
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

            for key in upsert_values:
                if key != "file_id":  # noqa: PLR2004
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
                        "_type": NotificationPayloadType.FILE_UPDATED,
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
    """Read cover art from ID3 APIC, MP4 covr, or FLAC/Vorbis METADATA_BLOCK_PICTURE."""
    if hasattr(audio, "tags") and audio.tags:
        tags = audio.tags

        for key in tags:
            if key.startswith("APIC"):
                frame = tags[key]
                if hasattr(frame, "data") and frame.data:
                    return frame.data

        if "covr" in tags:  # noqa: PLR2004
            covers = tags["covr"]
            if covers and len(covers) > 0:
                cover = covers[0]
                if isinstance(cover, bytes):
                    return cover
                if hasattr(cover, "data"):
                    return bytes(cover)
                return bytes(cover)

    if hasattr(audio, "pictures") and audio.pictures:
        pic = audio.pictures[0]
        if hasattr(pic, "data") and pic.data:
            return pic.data

    if hasattr(audio, "tags") and audio.tags and "metadata_block_picture" in audio.tags:  # noqa: PLR2004
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
