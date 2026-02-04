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
from uniffy.core.storage import get_s3_client
from uniffy.db import get_async_session
from uniffy.domains.auth.tokens import decode_access_token
from uniffy.domains.files.operations import FileOperations

router = APIRouter(prefix="/thumbnails", tags=["thumbnails"])


async def get_current_user_id(
    authorization: Annotated[str | None, Header()] = None,
) -> UUID:
    """
    Extract and validate user ID from Authorization header.

    This is the FastAPI equivalent of get_user_id_from_context for HTTP routes.

    Parameters
    ----------
    authorization : str | None
        Authorization header value (Bearer token).

    Returns
    -------
    UUID
        Authenticated user's ID.

    Raises
    ------
    HTTPException
        401 if token is missing, invalid, or expired.

    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization[7:]  # Remove "Bearer " prefix

    try:
        payload = decode_access_token(token)
        user_id = UUID(payload["sub"])
        return user_id
    except Exception as e:
        logger.debug(f"JWT decode error: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
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


@router.get("/{organization_id}/{file_id}")
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
        async for session in get_async_session():
            ops = FileOperations(session)

            # Get file and check permissions (this validates access)
            file = await ops.get_by_id(user_id, organization_id, file_id)

            # Check if thumbnail exists
            if not file.file_metadata or "thumbnail_key" not in file.file_metadata:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Thumbnail not available",
                )

            thumbnail_key = file.file_metadata["thumbnail_key"]

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
