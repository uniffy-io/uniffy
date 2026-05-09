"""
HTTP routes for files domain.

These are standard FastAPI HTTP endpoints (not ConnectRPC) for efficient
resource delivery like thumbnails that benefit from HTTP caching semantics.
"""

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
    """Return ``425 Too Early`` while a transcode is pending.

    The frontend reads ``transcode_status`` directly from the File proto
    and disables the Download button before the request even fires; this
    is the belt-and-braces guard for direct-link downloads and any
    middleware-driven retry.
    """

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
    """
    Extract organization ID from Authorization header if present.

    Parameters
    ----------
    authorization : str | None
        Authorization header value (Bearer token).

    Returns
    -------
    UUID | None
        Organization ID from token, or None if not present.

    """
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
    """
    Stream thumbnail image with HTTP caching support.

    This endpoint provides efficient thumbnail delivery with:
    - Proper HTTP cache headers (Cache-Control, ETag)
    - Streaming response (memory efficient)
    - Browser-native lazy loading support via standard <img> tags

    Parameters
    ----------
    organization_id : UUID
        Organization ID (from URL path).
    file_id : UUID
        File ID to get thumbnail for.
    user_id : UUID
        Authenticated user ID (injected by dependency).

    Returns
    -------
    StreamingResponse
        Thumbnail image with appropriate headers.

    Raises
    ------
    HTTPException
        401 if not authenticated.
        403 if user lacks permission to access file.
        404 if file or thumbnail not found.

    """
    try:
        async with open_session() as session:
            ops = FileOperations(session)

            # Get file and check permissions (this validates access)
            file = await ops.get_by_id(user_id, organization_id, file_id)

            # Check if thumbnail exists in media_info
            if not file.media_info or not file.media_info.thumbnail_key:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Thumbnail not available",
                )

            thumbnail_key = file.media_info.thumbnail_key

            # Get S3 client and stream the thumbnail
            s3 = get_s3_client()

            # Get object metadata for ETag and Content-Length
            try:
                metadata = await s3.get_object_info(thumbnail_key)
                etag = metadata.get("ETag", "").strip('"')
                content_length = metadata.get("ContentLength", 0)
            except Exception:
                # If we can't get metadata, proceed without caching headers
                etag = None
                content_length = None

            async def stream_thumbnail(
                _s3=s3,
                _thumbnail_key=thumbnail_key,
            ):
                """Stream thumbnail bytes from S3."""
                async for chunk, _, _ in _s3.download_stream(
                    key=_thumbnail_key,
                    chunk_size=64 * 1024,  # 64KB chunks for thumbnails
                ):
                    yield chunk

            # Build response headers
            headers = {
                "Content-Type": "image/jpeg",
                # Cache for 1 day, allow CDN caching
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
    """
    Stream full file content with HTTP caching support.

    This endpoint provides efficient file delivery with:
    - Proper HTTP cache headers (Cache-Control, ETag)
    - Streaming response (memory efficient)
    - Correct MIME type from file metadata

    Used for serving images and other files embedded in notes.

    Parameters
    ----------
    organization_id : UUID
        Organization ID (from URL path).
    file_id : UUID
        File ID to stream.
    user_id : UUID
        Authenticated user ID (injected by dependency).

    Returns
    -------
    StreamingResponse
        File content with appropriate headers.

    Raises
    ------
    HTTPException
        401 if not authenticated.
        403 if user lacks permission to access file.
        404 if file not found.

    """
    try:
        async with open_session() as session:
            ops = FileOperations(session)

            # Get file and check permissions (this validates access)
            file = await ops.get_by_id(user_id, organization_id, file_id)

            # Get the S3 key from file
            if not file.storage_key:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="File content not available",
                )

            # Gate the download while a server-side transcode is in flight.
            # The user-visible filename is `.mp4` from the moment Stop is
            # clicked even though the bytes on S3 may still be WebM. Serving
            # the WebM under that name would hand the user an unplayable
            # file in QuickTime / Finder / iOS, so block until the swap is
            # done. FAILED falls back to serving whatever is on the live
            # storage_key (the WebM) - playback in-browser still works and
            # blocking forever is worse than mismatched extensions.
            if file.transcode_status in (
                TranscodeStatus.PENDING,
                TranscodeStatus.PROCESSING,
            ):
                return _too_early_response()

            s3_key = file.storage_key
            mime_type = file.mime_type or "application/octet-stream"

            # Get S3 client and stream the file
            s3 = get_s3_client()

            # Get object metadata for Content-Length only. The ETag we send
            # to clients is derived from `File.version` so it changes on the
            # transcode swap (which moves storage_key without changing the
            # File row id). The S3 ETag belongs to the underlying object
            # and would mask the swap from intermediate caches.
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
                """Stream file bytes from S3."""
                async for chunk, _, _ in _s3.download_stream(
                    key=_s3_key,
                    chunk_size=256 * 1024,  # 256KB chunks for files
                ):
                    yield chunk

            headers = {
                "Content-Type": mime_type,
                # 5-minute revalidation so the post-transcode swap becomes
                # visible to clients without a hard refresh. The version-
                # derived ETag lets browsers / SW skip the body when the
                # underlying File row hasn't changed.
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


# Keep backward compatibility with the old `router` name
router = thumbnails_router
