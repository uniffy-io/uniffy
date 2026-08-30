"""FastAPI HTTP endpoints for thumbnails and file streaming with HTTP-cache semantics."""

import re
from functools import partial
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import StreamingResponse
from loguru import logger

from uniffy.core.auth.http import get_current_user_id
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.files.file import TranscodeStatus
from uniffy.core.storage import ObjectStorage
from uniffy.domains.files.operations import FileOperations
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="files.routes")

_TOO_EARLY_RETRY_AFTER_SECONDS = 60
_RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


def _parse_range(range_header: str, total_size: int) -> tuple[int, int]:
    """Resolve a ``Range: bytes=...`` header to an inclusive (start, end), clamped to the size."""
    match = _RANGE_RE.fullmatch(range_header.strip())
    if not match:
        return 0, total_size - 1
    start_raw, end_raw = match.group(1), match.group(2)
    if not start_raw and not end_raw:
        return 0, total_size - 1
    if not start_raw:
        # Suffix range: the last N bytes.
        return max(0, total_size - int(end_raw)), total_size - 1
    start = int(start_raw)
    end = int(end_raw) if end_raw else total_size - 1
    start = max(0, min(start, total_size - 1))
    end = max(start, min(end, total_size - 1))
    return start, end


def _too_early_response() -> StreamingResponse:
    """425 Too Early while a transcode is pending; guards direct-link downloads."""

    async def _empty_body():
        yield b""

    return StreamingResponse(
        _empty_body(),
        status_code=425,
        headers={
            "Retry-After": str(_TOO_EARLY_RETRY_AFTER_SECONDS),
            "Cache-Control": "no-store",
        },
        media_type="text/plain",
    )


async def get_thumbnail(
    storage: ObjectStorage,
    organization_id: UUID,
    file_id: UUID,
    user_id: Annotated[UUID, Depends(get_current_user_id)],
) -> StreamingResponse:
    """Stream a thumbnail with HTTP cache headers."""
    try:
        async with open_session() as session:
            ops = FileOperations(session, storage)

            file = await ops.get_by_id(user_id, organization_id, file_id)

            if not file.media_info or not file.media_info.thumbnail_key:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Thumbnail not available",
                )

            thumbnail_key = file.media_info.thumbnail_key

            try:
                metadata = await storage.get_object_info(thumbnail_key)
                etag = metadata.get("ETag", "").strip('"')
                content_length = metadata.get("ContentLength", 0)
            except Exception:
                etag = None
                content_length = None

            async def stream_thumbnail(
                _storage=storage,
                _thumbnail_key=thumbnail_key,
            ):
                async for chunk, _, _ in _storage.download_stream(
                    key=_thumbnail_key,
                    chunk_size=64 * 1024,
                ):
                    yield chunk

            headers = {
                "Content-Type": "image/jpeg",
                # private: permission-gated per-user content must never sit in a
                # shared cache. Short max-age bounds how long a revoked viewer's
                # browser can replay the cached bytes; the ETag keeps re-checks cheap.
                "Cache-Control": "private, max-age=300, must-revalidate",
            }

            if etag:
                headers["ETag"] = f'"{etag}"'

            if content_length:
                headers["Content-Length"] = str(content_length)

            return StreamingResponse(
                stream_thumbnail(),
                media_type="image/jpeg",
                headers=headers,
            )

    except NotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found",
        )
    except PermissionDeniedError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error getting thumbnail: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error",
        )


async def stream_file(
    storage: ObjectStorage,
    organization_id: UUID,
    file_id: UUID,
    user_id: Annotated[UUID, Depends(get_current_user_id)],
) -> StreamingResponse:
    """Stream file content with HTTP cache headers; used for images embedded in notes."""
    try:
        async with open_session() as session:
            ops = FileOperations(session, storage)

            file = await ops.get_by_id(user_id, organization_id, file_id)

            if not file.storage_key:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="File content not available",
                )

            # Gate while transcode is in flight: filename says .mp4 but bytes may still be WebM.
            if file.transcode_status in (
                TranscodeStatus.PENDING,
                TranscodeStatus.PROCESSING,
            ):
                return _too_early_response()

            s3_key = file.storage_key
            mime_type = file.mime_type or "application/octet-stream"

            # ETag derives from File.version so transcode swap invalidates intermediate caches.
            try:
                metadata = await storage.get_object_info(s3_key)
                content_length = metadata.get("ContentLength", 0)
            except Exception:
                content_length = None

            file_version = file.version
            file_filename = file.filename

            async def stream_file_content(
                _storage=storage,
                _storage_key=s3_key,
            ):
                async for chunk, _, _ in _storage.download_stream(
                    key=_storage_key,
                    chunk_size=256 * 1024,
                ):
                    yield chunk

            headers = {
                "Content-Type": mime_type,
                # private: permission-gated content stays out of shared caches. 5-minute
                # revalidation so a post-transcode swap propagates without a hard refresh.
                "Cache-Control": "private, max-age=300, must-revalidate",
                "ETag": f'"{file_id}.v{file_version}"',
                "Content-Disposition": f'inline; filename="{file_filename}"',
            }

            if content_length:
                headers["Content-Length"] = str(content_length)

            return StreamingResponse(
                stream_file_content(),
                media_type=mime_type,
                headers=headers,
            )

    except NotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found",
        )
    except PermissionDeniedError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error streaming file: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error",
        )


async def stream_media(
    storage: ObjectStorage,
    organization_id: UUID,
    file_id: UUID,
    user_id: Annotated[UUID, Depends(get_current_user_id)],
    range_header: Annotated[str | None, Header(alias="range")] = None,
) -> StreamingResponse:
    """Range-capable media stream so <video>/<audio> can seek; authed by cookie or Bearer."""
    try:
        async with open_session() as session:
            ops = FileOperations(session, storage)

            file = await ops.get_by_id(user_id, organization_id, file_id)

            if not file.storage_key:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="File content not available",
                )

            if file.transcode_status in (
                TranscodeStatus.PENDING,
                TranscodeStatus.PROCESSING,
            ):
                return _too_early_response()

            mime_type = file.mime_type or "application/octet-stream"

            try:
                metadata = await storage.get_object_info(file.storage_key)
                total_size = int(metadata.get("ContentLength", 0))
            except Exception:
                total_size = 0

            headers = {
                "Accept-Ranges": "bytes",
                # private: permission-gated media stays out of shared caches.
                "Cache-Control": "private, max-age=300, must-revalidate",
                "ETag": f'"{file_id}.v{file.version}"',
                "Content-Disposition": f'inline; filename="{file.filename}"',
            }

            if range_header and total_size:
                start, end = _parse_range(range_header, total_size)
                headers["Content-Range"] = f"bytes {start}-{end}/{total_size}"
                headers["Content-Length"] = str(end - start + 1)
                status_code = status.HTTP_206_PARTIAL_CONTENT
            else:
                start, end = 0, None
                if total_size:
                    headers["Content-Length"] = str(total_size)
                status_code = status.HTTP_200_OK

            storage_key = file.storage_key

            async def stream_media_content(
                _storage=storage,
                _key=storage_key,
                _start=start,
                _end=end,
            ):
                async for chunk, _total, _range_start, _range_end in _storage.download_range(
                    key=_key,
                    start_byte=_start,
                    end_byte=_end,
                ):
                    yield chunk

            return StreamingResponse(
                stream_media_content(),
                status_code=status_code,
                media_type=mime_type,
                headers=headers,
            )

    except NotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found",
        )
    except PermissionDeniedError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error streaming media: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error",
        )


def create_file_routers(
    storage: ObjectStorage,
) -> tuple[APIRouter, APIRouter, APIRouter]:
    thumbnails = APIRouter(prefix="/thumbnails", tags=["thumbnails"])
    files = APIRouter(prefix="/files", tags=["files"])
    media = APIRouter(prefix="/media", tags=["media"])
    path = "/{organization_id}/{file_id}"
    thumbnails.add_api_route(path, partial(get_thumbnail, storage), methods=["GET"])
    files.add_api_route(path, partial(stream_file, storage), methods=["GET"])
    media.add_api_route(path, partial(stream_media, storage), methods=["GET"])
    return thumbnails, files, media
