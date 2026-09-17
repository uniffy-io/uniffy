"""Stream media through bounded local files and S3 multipart buffers."""

from collections.abc import Awaitable, Callable
from pathlib import Path

import aiofiles
from loguru import logger

from uniffy.core.storage import ObjectStorage
from uniffy.domains.files.jobs.media import MediaError

logger = logger.bind(component="files.jobs.scratch")

_PART_BYTES = 8 * 1024**2


async def download_source(storage: ObjectStorage, key: str, path: Path, limit: int) -> None:
    metadata = await storage.get_object_info(key)
    if int(metadata.get("ContentLength", 0)) > limit:
        raise MediaError("Video exceeds source size limit")
    size = 0
    async with aiofiles.open(path, "wb") as target:
        async for chunk, _, _ in storage.download_stream(key, chunk_size=1024**2):
            size += len(chunk)
            if size > limit:
                raise MediaError("Video exceeds source size limit")
            await target.write(chunk)


async def upload_video(
    storage: ObjectStorage,
    key: str,
    path: Path,
    record_upload: Callable[[str], Awaitable[None]],
) -> None:
    upload_id = await storage.create_multipart_upload(key, "video/mp4")
    try:
        await record_upload(upload_id)
        parts = []
        async with aiofiles.open(path, "rb") as source:
            while data := await source.read(_PART_BYTES):
                number = len(parts) + 1
                etag = await storage.upload_part(key, upload_id, number, data)
                parts.append({"PartNumber": number, "ETag": etag})
        if not parts:
            raise MediaError("Encoder produced empty output")
        await storage.complete_multipart_upload(key, upload_id, parts)
    except BaseException:
        try:
            await storage.abort_multipart_upload(key, upload_id)
        except Exception:
            logger.warning("Multipart abort deferred to media cleanup", key=key)
        raise
