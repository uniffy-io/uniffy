"""FastAPI HTTP endpoints for thumbnails and file streaming with HTTP-cache semantics."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import StreamingResponse
from loguru import logger

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.files.file import TranscodeStatus
from uniffy.core.storage import get_s3_client
from uniffy.db import open_session
from uniffy.domains.auth.http_deps import get_current_user_id
from uniffy.domains.auth.tokens import decode_access_token
from uniffy.domains.files.operations import FileOperations

thumbnails_router = APIRouter(prefix="/thumbnails", tags=["thumbnails"])
files_router = APIRouter(prefix="/files", tags=["files"])

_TOO_EARLY_RETRY_AFTER_SECONDS = 60


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


async def get_organization_id_from_token(
    authorization: Annotated[str | None, Header()] = None,
) -> UUID | None:
    """Extract organization ID from a Bearer token if present."""
    if not authorization or not authorization.startswith("Bearer "):
        return None

    token = authorization[7:]

    try:
        payload = decode_access_token(token)
        org_id = payload.get("org_id")
        return UUID(org_id) if org_id else None
    except Exception:
        return None


@thumbnails_router.get("/{organization_id}/{file_id}")
async def get_thumbnail(
    organization_id: UUID,
    file_id: UUID,
    user_id: Annotated[UUID, Depends(get_current_user_id)],
) -> StreamingResponse:
    """Stream a thumbnail with HTTP cache headers."""
    try:
        async with open_session() as session:
            ops = FileOperations(session)

            file = await ops.get_by_id(user_id, organization_id, file_id)

            if not file.media_info or not file.media_info.thumbnail_key:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Thumbnail not available",
                )

            thumbnail_key = file.media_info.thumbnail_key

            s3 = get_s3_client()

            try:
                metadata = await s3.get_object_info(thumbnail_key)
                etag = metadata.get("ETag", "").strip('"')
                content_length = metadata.get("ContentLength", 0)
            except Exception:
                etag = None
                content_length = None

            async def stream_thumbnail(
                _s3=s3,
                _thumbnail_key=thumbnail_key,
            ):
                async for chunk, _, _ in _s3.download_stream(
                    key=_thumbnail_key,
                    chunk_size=64 * 1024,
                ):
                    yield chunk

            headers = {
                "Content-Type": "image/jpeg",
                "Cache-Control": "public, max-age=86400, immutable",
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
        logger.error(f"Error getting thumbnail: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error",
        )


@files_router.get("/{organization_id}/{file_id}")
async def stream_file(
    organization_id: UUID,
    file_id: UUID,
    user_id: Annotated[UUID, Depends(get_current_user_id)],
) -> StreamingResponse:
    """Stream file content with HTTP cache headers; used for images embedded in notes."""
    try:
        async with open_session() as session:
            ops = FileOperations(session)

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

            s3 = get_s3_client()

            # ETag derives from File.version so transcode swap invalidates intermediate caches.
            try:
                metadata = await s3.get_object_info(s3_key)
                content_length = metadata.get("ContentLength", 0)
            except Exception:
                content_length = None

            file_version = file.version
            file_filename = file.filename

            async def stream_file_content(
                _s3=s3,
                _s3_key=s3_key,
            ):
                async for chunk, _, _ in _s3.download_stream(
                    key=_s3_key,
                    chunk_size=256 * 1024,
                ):
                    yield chunk

            headers = {
                "Content-Type": mime_type,
                # 5-minute revalidation so post-transcode swap propagates without hard refresh.
                "Cache-Control": "public, max-age=300, must-revalidate",
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
        logger.error(f"Error streaming file: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error",
        )


router = thumbnails_router
