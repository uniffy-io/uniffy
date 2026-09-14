"""Cancel pending requests when their target becomes accessible."""

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.permissions.v1.permissions_pb2 import ACCESS_REQUEST_STATE_CANCELED

from uniffy.core.events.realtime import publish_access_request_changed
from uniffy.core.models.permissions.content_access_request import (
    ContentAccessRequest,
    ContentAccessRequestState,
)
from uniffy.core.types import ContentType

logger = logger.bind(component="permissions.requests.dismissal")


@dataclass(frozen=True, slots=True)
class DismissedAccessRequest:
    id: UUID
    requester_id: UUID
    requested_urn: str


async def stage_dismiss_pending_requests(
    session: AsyncSession,
    *,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
) -> list[DismissedAccessRequest]:
    """Join the target mutation without overwriting concurrent terminal decisions."""
    now = datetime.now(UTC)
    rows = await session.execute(
        update(ContentAccessRequest)
        .where(
            ContentAccessRequest.organization_id == organization_id,
            ContentAccessRequest.canonical_content_type == content_type,
            ContentAccessRequest.canonical_content_id == content_id,
            ContentAccessRequest.state == ContentAccessRequestState.PENDING,
        )
        .values(
            state=ContentAccessRequestState.CANCELED,
            responded_at=now,
            updated_at=now,
        )
        .returning(
            ContentAccessRequest.id,
            ContentAccessRequest.requester_id,
            ContentAccessRequest.requested_urn,
        )
        .execution_options(synchronize_session=False)
    )
    return [DismissedAccessRequest(*row) for row in rows]


async def publish_dismissed_requests(requests: list[DismissedAccessRequest]) -> None:
    """Tell each requester their pending chip is resolved. Post-commit only."""
    for request in requests:
        try:
            await publish_access_request_changed(
                user_id=request.requester_id,
                request_id=request.id,
                requested_urn=request.requested_urn,
                state=ACCESS_REQUEST_STATE_CANCELED,
            )
        except Exception:
            logger.opt(exception=True).warning(
                f"Failed to publish dismissal for access request {request.id}"
            )
