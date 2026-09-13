"""HTTP endpoints for the calendar: subscribe feeds, and responding to mail."""

import hashlib
from functools import partial
from typing import Annotated
from uuid import UUID

import jwt
from fastapi import APIRouter, Body, Header, HTTPException, Response, status
from loguru import logger
from pydantic import BaseModel

from uniffy.core.audit.request_context import client_ip_for_rate_limit
from uniffy.core.auth.tokens import decode_event_response_token
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.shared import AttendeeStatus
from uniffy.core.rate_limit import check_rate_limit
from uniffy.core.search import SearchIndexer
from uniffy.domains.scheduling.calendar.ical.feed import (
    FEED_SUFFIX,
    hash_token,
    record_fetch,
    render_feed,
    resolve_feed,
)
from uniffy.domains.scheduling.calendar.operations import CalendarEventOperations
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="scheduling.calendar.routes")

RESPOND_PATH = "/respond"
FEED_PATH = "/feed/{token}"

# A link lives in an inbox, so the bucket is per token rather than per session.
RESPOND_LIMIT = 20
RESPOND_WINDOW_SECONDS = 3600

_STATUS_FROM_LINK: dict[str, AttendeeStatus] = {
    "accepted": AttendeeStatus.ACCEPTED,
    "tentative": AttendeeStatus.TENTATIVE,
    "declined": AttendeeStatus.DECLINED,
}

# A calendar client polls hourly; the ceiling is generous enough that a
# misconfigured one retrying every minute still works, and low enough that the
# URL is not a bulk-read channel.
FEED_LIMIT_TOKEN = 120
FEED_LIMIT_IP = 600
FEED_WINDOW_SECONDS = 3600

ICALENDAR_MEDIA_TYPE = "text/calendar; charset=utf-8"

# Revalidate on every poll, but keep the document out of shared caches and off
# disk. `no-store` would forbid retaining the validator too, which is what makes
# the conditional request cheap, so `no-cache` is the directive that matches the
# intent: store it, never serve it without asking first.
FEED_CACHE_CONTROL = "private, no-cache"

_INVALID_LINK = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="This link is no longer valid",
)

# An unknown, revoked, or deactivated feed answers the same way a URL that was
# never minted does, so probing the endpoint tells an outsider nothing.
_NO_SUCH_FEED = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail="No such calendar feed",
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


async def serve_feed(
    token: str,
    if_none_match: Annotated[str | None, Header()] = None,
) -> Response:
    """Serve one subscription as iCalendar, for a calendar client to poll.

    Unauthenticated by necessity - Outlook, Google and Apple subscribe to a
    plain URL and cannot carry a session - so the token both names the
    subscriber and is the whole credential. It grants nothing beyond reading:
    the document is built by the ordinary permission-filtered query run as that
    person, and their standing is rechecked here on every fetch.
    """
    raw_token = token.removesuffix(FEED_SUFFIX)

    # The per-token bucket is the load-bearing one: it bounds anyone holding a
    # URL. The per-IP bucket bounds spraying guesses, and is skipped rather than
    # enforced blindly when a proxy leaves the client address unknowable.
    await check_rate_limit(
        key=f"rl:calendar:feed:token:{hash_token(raw_token)}",
        limit=FEED_LIMIT_TOKEN,
        window_seconds=FEED_WINDOW_SECONDS,
        resource="calendar feed fetches (per feed)",
    )
    rate_limit_ip = client_ip_for_rate_limit()
    if rate_limit_ip:
        await check_rate_limit(
            key=f"rl:calendar:feed:ip:{rate_limit_ip}",
            limit=FEED_LIMIT_IP,
            window_seconds=FEED_WINDOW_SECONDS,
            resource="calendar feed fetches (per ip)",
        )

    async with open_session() as session:
        row = await resolve_feed(session, raw_token)
        if row is None:
            raise _NO_SUCH_FEED

        document = await render_feed(session, row)
        await record_fetch(session, row)

    # The whole document is the validator. Anything cheaper - a row count, a
    # newest timestamp - misses an edit that changes the body without changing
    # the events themselves, such as an attendee accepting.
    etag = f'"{hashlib.sha256(document).hexdigest()}"'
    headers = {"ETag": etag, "Cache-Control": FEED_CACHE_CONTROL}

    if if_none_match and if_none_match.strip() == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)

    return Response(
        content=document,
        media_type=ICALENDAR_MEDIA_TYPE,
        headers=headers,
    )


def create_calendar_router(search_indexer: SearchIndexer) -> APIRouter:
    router = APIRouter(prefix="/calendar", tags=["calendar"])
    router.add_api_route(
        RESPOND_PATH,
        partial(respond_from_mail, search_indexer),
        methods=["POST"],
        response_model=RespondResponse,
    )
    router.add_api_route(FEED_PATH, serve_feed, methods=["GET"])
    return router
