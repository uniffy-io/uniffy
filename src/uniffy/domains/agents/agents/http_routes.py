"""HTTP routes for agent avatars.

Identity comes from the shared asset dependency (Bearer or the asset-read
cookie); the org check below is this route's own gate.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from loguru import logger
from sqlalchemy import select

from uniffy.core.avatars import AVATAR_SIZES
from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.agents.agent import Agent
from uniffy.core.storage import get_s3_client
from uniffy.db import open_session
from uniffy.domains.auth.http_deps import get_current_user_id
from uniffy.domains.organizations.operations import OrganizationOperations

logger = logger.bind(component="agents.agents.http_routes")

agent_avatars_router = APIRouter(prefix="/agents/avatars", tags=["agent-avatars"])


@agent_avatars_router.get("/{agent_id}/{size}", response_model=None)
async def get_agent_avatar(
    agent_id: UUID,
    size: str,
    current_user_id: Annotated[UUID, Depends(get_current_user_id)],
    if_none_match: Annotated[str | None, Header()] = None,
) -> StreamingResponse | Response:
    """Stream an agent avatar as WebP, sizes ``sm`` / ``md`` / ``lg``."""
    if size not in AVATAR_SIZES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid size. Must be one of: {', '.join(sorted(AVATAR_SIZES))}",
        )

    try:
        async with open_session() as session:
            result = await session.execute(
                select(Agent).where(
                    Agent.id == agent_id,
                    Agent.is_deleted == False,  # noqa: E712
                )
            )
            agent = result.scalar_one_or_none()

            if not agent:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Agent not found",
                )

            # The agent id is the only path input, so the caller's membership of
            # the agent's org is what keeps this from being a cross-tenant read.
            try:
                await OrganizationOperations(session).require_org_member(
                    current_user_id, agent.organization_id
                )
            except PermissionDeniedError:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Agent not found",
                )

            if not agent.avatar_key:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Avatar not available",
                )

            # Extract content hash from avatar_key for ETag
            content_hash = agent.avatar_key.rsplit("/", 1)[-1]
            etag = f'"{content_hash}"'

            # Return 304 if the client already has this version
            if if_none_match and if_none_match.strip() == etag:
                return Response(
                    status_code=status.HTTP_304_NOT_MODIFIED,
                    headers={
                        "ETag": etag,
                        "Cache-Control": "public, max-age=600, must-revalidate",
                    },
                )

            s3_key = f"{agent.avatar_key}/{size}.webp"
            s3 = get_s3_client()

            # Get object metadata for Content-Length
            try:
                metadata = await s3.get_object_info(s3_key)
                content_length = metadata.get("ContentLength", 0)
            except Exception:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Avatar not available",
                )

            async def stream_avatar(
                _s3=s3,
                _s3_key=s3_key,
            ):
                """Stream avatar bytes from S3."""
                async for chunk, _, _ in _s3.download_stream(
                    key=_s3_key,
                    chunk_size=64 * 1024,
                ):
                    yield chunk

            headers = {
                "Content-Type": "image/webp",
                "ETag": etag,
                # Cache for 5 minutes, then revalidate via ETag
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
        logger.exception(f"Error getting agent avatar: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error",
        )
