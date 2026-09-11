"""HTTP endpoints for the calendar: responding to an invitation from mail."""

from functools import partial
from typing import Annotated
from uuid import UUID

import jwt
from fastapi import APIRouter, Body, HTTPException, status
from loguru import logger
from pydantic import BaseModel

from uniffy.core.auth.tokens import decode_event_response_token
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.shared import AttendeeStatus
from uniffy.core.rate_limit import check_rate_limit
from uniffy.core.search import SearchIndexer
from uniffy.domains.scheduling.calendar.operations import CalendarEventOperations
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="scheduling.calendar.routes")

RESPOND_PATH = "/respond"

# A link lives in an inbox, so the bucket is per token rather than per session.
RESPOND_LIMIT = 20
RESPOND_WINDOW_SECONDS = 3600

_STATUS_FROM_LINK: dict[str, AttendeeStatus] = {
    "accepted": AttendeeStatus.ACCEPTED,
    "tentative": AttendeeStatus.TENTATIVE,
    "declined": AttendeeStatus.DECLINED,
}

_INVALID_LINK = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="This link is no longer valid",
)


class RespondRequest(BaseModel):
    token: str
    response: str


class RespondResponse(BaseModel):
    status: str
    event_id: str


async def respond_from_mail(
    search_indexer: SearchIndexer,
    payload: Annotated[RespondRequest, Body()],
) -> RespondResponse:
    """Record an attendee's response to an invitation they received by mail.

    Deliberately not a GET: a link scanner opening every URL in a message must
    not be able to accept a meeting on somebody's behalf.

    The token names the attendee and the event and nothing else. Whether that
    person may still respond is resolved by the ordinary access path, so a
    removed or deactivated member cannot use a link they kept.
    """
    attendee_status = _STATUS_FROM_LINK.get(payload.response.lower())
    if attendee_status is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unknown response",
        )

    try:
        claims = decode_event_response_token(payload.token)
    except jwt.PyJWTError as exc:
        raise _INVALID_LINK from exc

    await check_rate_limit(
        key=f"rl:calendar:respond:{claims['sub']}:{claims['eid']}",
        limit=RESPOND_LIMIT,
        window_seconds=RESPOND_WINDOW_SECONDS,
        resource="invitation responses",
    )

    try:
        user_id = UUID(claims["sub"])
        organization_id = UUID(claims["org_id"])
        event_id = UUID(claims["eid"])
    except (KeyError, ValueError) as exc:
        raise _INVALID_LINK from exc

    try:
        async with open_session() as session:
            await CalendarEventOperations(session, search_indexer).update_attendee_status(
                user_id=user_id,
                organization_id=organization_id,
                event_id=event_id,
                status=attendee_status,
            )
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="This event is no longer available"
        ) from exc
    except PermissionDeniedError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="You are no longer invited"
        ) from exc
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return RespondResponse(status=attendee_status.value, event_id=str(event_id))


def create_calendar_router(search_indexer: SearchIndexer) -> APIRouter:
    router = APIRouter(prefix="/calendar", tags=["calendar"])
    router.add_api_route(
        RESPOND_PATH,
        partial(respond_from_mail, search_indexer),
        methods=["POST"],
        response_model=RespondResponse,
    )
    return router
