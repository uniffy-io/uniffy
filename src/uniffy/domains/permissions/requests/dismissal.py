"""Closing pending access requests that the content itself has made moot.

The capability another domain reaches for when a mutation grants the access a
request was asking for - opening a channel to the organization, for instance.
Deliberately free of `operations.py` so the owning domain can import it without
pulling the access-grant machinery, which imports back into chat.
"""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.permissions.v1.permissions_pb2 import ACCESS_REQUEST_STATE_CANCELED

from uniffy.core.events.realtime import publish_access_request_changed
from uniffy.core.models.permissions.content_access_request import (
    ContentAccessRequest,
    ContentAccessRequestState,
)
from uniffy.core.types import ContentType

logger = logger.bind(component="permissions.requests.dismissal")


async def stage_dismiss_pending_requests(
    session: AsyncSession,
    *,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
) -> list[ContentAccessRequest]:
    """Cancel every pending request for this content; returns the rows to publish.

    Joins the caller's transaction and never commits, so the dismissal and the
    mutation that granted the access land together. CANCELED rather than
    APPROVED: nobody decided anything, and no grant row was written - the
    request simply has nothing left to ask for.
    """
    rows = (
        (
            await session.execute(
                select(ContentAccessRequest).where(
                    ContentAccessRequest.organization_id == organization_id,
                    ContentAccessRequest.canonical_content_type == content_type,
                    ContentAccessRequest.canonical_content_id == content_id,
                    ContentAccessRequest.state == ContentAccessRequestState.PENDING,
                )
            )
        )
        .scalars()
        .all()
    )

    now = datetime.now(UTC)
    for row in rows:
        row.state = ContentAccessRequestState.CANCELED
        row.responded_at = now
        row.updated_at = now
        session.add(row)
    return list(rows)


async def publish_dismissed_requests(requests: list[ContentAccessRequest]) -> None:
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
