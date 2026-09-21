"""Produce complete compatibility MP4 copies without changing uploaded bytes."""

import asyncio
import tempfile
from functools import partial
from pathlib import Path
from typing import Any, cast
from uuid import UUID

from loguru import logger

from uniffy.core.events.realtime import NotificationPayloadType, publish_notification
from uniffy.core.models.files.file import PlaybackStatus
from uniffy.core.storage import OBJECT_STORAGE_CTX_KEY, ObjectStorage
from uniffy.domains.files.jobs.media import MediaError, is_web_safe, probe, rendition_args, run_media
from uniffy.domains.files.jobs.playback import claim_playback, finish_playback, record_multipart
from uniffy.domains.files.jobs.scratch import upload_video
from uniffy.domains.files.jobs.settings import MEDIA_SETTINGS
from uniffy.domains.files.jobs.slots import MEDIA_SLOTS_CTX_KEY, MediaSlots
from uniffy.domains.files.jobs.source import MEDIA_SOURCE_CTX_KEY, MediaSourceServer
from uniffy.vendor.arq import Retry

logger = logger.bind(component="files.jobs.renditions")


async def generate_playback_rendition(
    ctx: dict[str, Any], file_id: str, organization_id: str
) -> None:
    file_uuid, org_uuid = UUID(file_id), UUID(organization_id)
    if not MEDIA_SETTINGS.enabled:
        await claim_playback(file_uuid, org_uuid)
        return
    slots = cast(MediaSlots, ctx[MEDIA_SLOTS_CTX_KEY])
    async with slots.acquire() as acquired:
        if not acquired:
            raise Retry(defer=5, count_attempt=False)
        claim = await claim_playback(file_uuid, org_uuid)
        if claim is None:
            return
        storage = cast(ObjectStorage, ctx[OBJECT_STORAGE_CTX_KEY])
        try:
            async with asyncio.timeout(MEDIA_SETTINGS.job_timeout - 30):
                if claim.size_bytes > MEDIA_SETTINGS.max_source_bytes:
                    raise MediaError("Video exceeds source size limit")
                with tempfile.TemporaryDirectory(
                    prefix="uniffy-playback-", dir=MEDIA_SETTINGS.scratch_directory
                ) as directory:
                    output = Path(directory) / "playback.mp4"
                    sources = cast(MediaSourceServer, ctx[MEDIA_SOURCE_CTX_KEY])
                    async with sources.open(
                        claim.source_key, MEDIA_SETTINGS.max_source_bytes
                    ) as source:
                        info = await probe(source)
                        if not is_web_safe(info):
                            if info.duration > MEDIA_SETTINGS.max_duration_seconds:
                                raise MediaError("Video exceeds duration limit")
                            await run_media(
                                "ffmpeg",
                                rendition_args(source, output, info, MEDIA_SETTINGS),
                                max(MEDIA_SETTINGS.timeout_floor, info.duration * 4),
                            )
                    if is_web_safe(info):
                        await finish_playback(claim, PlaybackStatus.NOT_NEEDED)
                        return
                    result = await probe(output)
                    if (
                        not is_web_safe(result)
                        or result.duration < info.duration - max(1, info.duration * 0.01)
                        or output.stat().st_size >= MEDIA_SETTINGS.max_output_bytes
                    ):
                        raise MediaError("Incomplete or incompatible encoder output")
                    await upload_video(
                        storage,
                        claim.output_key,
                        output,
                        partial(record_multipart, claim.output_key),
                    )
                    await finish_playback(claim, PlaybackStatus.COMPLETED)
        except asyncio.CancelledError:
            await finish_playback(claim, PlaybackStatus.PENDING, "Conversion interrupted")
            raise
        except Exception as error:
            logger.opt(exception=True).warning("Playback conversion failed", file_id=file_id)
            terminal = isinstance(error, MediaError) or claim.attempt >= 3
            await finish_playback(
                claim, PlaybackStatus.FAILED if terminal else PlaybackStatus.PENDING, str(error)
            )
        finally:
            try:
                await publish_notification(
                    claim.owner_id,
                    {
                        "_type": NotificationPayloadType.FILE_UPDATED,
                        "file_id": file_id,
                        "organization_id": organization_id,
                    },
                )
            except Exception:
                logger.opt(exception=True).warning("Playback update notification failed")
