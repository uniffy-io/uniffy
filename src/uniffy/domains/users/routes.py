"""HTTP routes for user avatars.

Auth is handled via service worker token injection - <img> tags cannot send
Authorization headers, so we rely on the SW to attach them per request.
"""

from functools import partial
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from loguru import logger
from sqlalchemy import select

from uniffy.core.auth.http import get_current_user_id
from uniffy.core.models.login.user import User
from uniffy.core.storage import ObjectStorage
from uniffy.domains.users.avatars import AVATAR_SIZES
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="users.routes")


async def get_avatar(
    storage: ObjectStorage,
    user_id: UUID,
    size: str,
    _current_user_id: Annotated[UUID, Depends(get_current_user_id)],
    if_none_match: Annotated[str | None, Header()] = None,
) -> StreamingResponse | Response:
    if size not in AVATAR_SIZES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid size. Must be one of: {', '.join(sorted(AVATAR_SIZES))}",
        )

    try:
        async with open_session() as session:
            result = await session.execute(select(User).where(User.id == user_id))
            user = result.scalar_one_or_none()

            if not user:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="User not found",
                )

            if not user.avatar_key:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Avatar not available",
                )

            # avatar_key format: '{prefix}/{entity_id}/{hash}'. Hash is the ETag.
            content_hash = user.avatar_key.rsplit("/", 1)[-1]
            etag = f'"{content_hash}"'

            if if_none_match and if_none_match.strip() == etag:
                return Response(
                    status_code=status.HTTP_304_NOT_MODIFIED,
                    headers={
                        "ETag": etag,
                        "Cache-Control": "public, max-age=600, must-revalidate",
                    },
                )

            s3_key = f"{user.avatar_key}/{size}.webp"
            try:
                metadata = await storage.get_object_info(s3_key)
                content_length = metadata.get("ContentLength", 0)
            except Exception:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Avatar not available",
                )

            async def stream_avatar(
                _storage=storage,
                _storage_key=s3_key,
            ):
                async for chunk, _, _ in _storage.download_stream(
                    key=_storage_key,
                    chunk_size=64 * 1024,
                ):
                    yield chunk

            headers = {
                "Content-Type": "image/webp",
                "ETag": etag,
                "Cache-Control": "public, max-age=600, must-revalidate",
            }

            if content_length:
                headers["Content-Length"] = str(content_length)

            return StreamingResponse(
                stream_avatar(),
                media_type="image/webp",
                headers=headers,
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error getting avatar: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error",
        )


def create_avatars_router(storage: ObjectStorage) -> APIRouter:
    router = APIRouter(prefix="/avatars", tags=["avatars"])
    router.add_api_route(
        "/{user_id}/{size}",
        partial(get_avatar, storage),
        methods=["GET"],
        response_model=None,
    )
    return router
