"""Provider change notifications: verified by the channel secret, they only move the next sync up."""

import hmac
from datetime import UTC, datetime
from uuid import UUID

from fastapi import Request, Response, status
from loguru import logger
from sqlalchemy import select, update

from uniffy.core.jobs import enqueue_job_reconnecting
from uniffy.core.json_codec import JSONDecodeError, loads
from uniffy.core.models.calendar.connection import (
    CalendarConnection,
    CalendarProvider,
    ConnectedCalendar,
    ConnectedCalendarState,
    ConnectionStatus,
)
from uniffy.domains.scheduling.calendar.connections.channels import secret_digest
from uniffy.domains.scheduling.calendar.jobs.contracts import SYNC_CONNECTED_CALENDAR
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="scheduling.calendar.connections.ingress")

MAX_BODY_BYTES = 1024 * 1024
_VALIDATION_TOKEN_LIMIT = 2048
# Graph batches notifications per subscription; one request never names more than a few.
_MAX_NOTIFICATIONS = 50
# Notifications for one calendar inside this many seconds wake one sync, not one each.
_WAKE_BUCKET_SECONDS = 10


async def _wake(
    channel_id: str,
    secret: str,
    provider: CalendarProvider,
    *,
    rescan: bool,
    renew: bool = False,
) -> bool:
    async with open_session() as session:
        row = (
            await session.execute(
                select(
                    ConnectedCalendar.id,
                    ConnectedCalendar.push_secret_digest,
                    CalendarConnection.generation,
                )
                .join(CalendarConnection, CalendarConnection.id == ConnectedCalendar.connection_id)
                .where(
                    ConnectedCalendar.push_channel_id == channel_id,
                    ConnectedCalendar.state == ConnectedCalendarState.ACTIVE,
                    ConnectedCalendar.sync_enabled.is_(True),
                    CalendarConnection.provider == provider,
                    CalendarConnection.status == ConnectionStatus.ACTIVE,
                )
            )
        ).first()
        if row is None or not row.push_secret_digest:
            return False
        if not hmac.compare_digest(row.push_secret_digest, secret_digest(secret)):
            return False
        values: dict[str, object] = {"next_sync_at": datetime.now(UTC)}
        if rescan:
            values["cursor"] = None
        if renew:
            # The next round renews the subscription before anything else lapses.
            values["push_expires_at"] = datetime.now(UTC)
        await session.execute(
            update(ConnectedCalendar).where(ConnectedCalendar.id == row.id).values(**values)
        )
        await session.commit()
    await _enqueue(row.id, row.generation)
    return True


async def _enqueue(connected_calendar_id: UUID, generation: int) -> None:
    bucket = int(datetime.now(UTC).timestamp()) // _WAKE_BUCKET_SECONDS
    try:
        await enqueue_job_reconnecting(
            SYNC_CONNECTED_CALENDAR,
            str(connected_calendar_id),
            generation,
            _job_id=f"calendar-push-wake:{connected_calendar_id}:{bucket}",
        )
    except Exception:
        logger.warning("Push wakeup deferred to the dispatcher")


async def _bounded_body(request: Request) -> bytes | None:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        return None
    # Read in pieces so a chunked body without a length is cut off at the cap, not buffered.
    body = bytearray()
    async for piece in request.stream():
        body.extend(piece)
        if len(body) > MAX_BODY_BYTES:
            return None
    return bytes(body)


async def receive_google(request: Request) -> Response:
    """Always 204: the provider learns nothing, and polling stays the backstop for anything lost."""
    channel_id = request.headers.get("x-goog-channel-id") or ""
    secret = request.headers.get("x-goog-channel-token") or ""
    state = request.headers.get("x-goog-resource-state") or ""
    # The first message only confirms the channel exists.
    if channel_id and secret and state != "sync":  # noqa: PLR2004 - Google resource state
        try:
            accepted = await _wake(channel_id[:255], secret, CalendarProvider.GOOGLE, rescan=False)
        except Exception:
            logger.opt(exception=True).warning("Google push notification not processed")
            accepted = False
        if not accepted:
            logger.info("Google push notification ignored", resource_state=state[:40])
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def receive_microsoft(request: Request) -> Response:
    token = request.query_params.get("validationToken")
    if token is not None:
        # Graph proves the endpoint is ours before it creates a subscription.
        return Response(
            content=token[:_VALIDATION_TOKEN_LIMIT],
            media_type="text/plain",
            status_code=status.HTTP_200_OK,
        )
    body = await _bounded_body(request)
    if body is None:
        return Response(status_code=status.HTTP_413_CONTENT_TOO_LARGE)
    try:
        payload = loads(body) if body else {}
    except JSONDecodeError:
        return Response(status_code=status.HTTP_400_BAD_REQUEST)
    values = payload.get("value") if isinstance(payload, dict) else None
    woken = 0
    seen: set[tuple[str, object]] = set()
    for item in values if isinstance(values, list) else []:
        if not isinstance(item, dict):
            continue
        subscription_id = str(item.get("subscriptionId") or "")[:255]
        secret = str(item.get("clientState") or "")
        lifecycle = item.get("lifecycleEvent")
        if not subscription_id or not secret or (subscription_id, lifecycle) in seen:
            continue
        # Each distinct subscription costs a lookup; a forged batch cannot buy unbounded ones.
        if len(seen) >= _MAX_NOTIFICATIONS:
            break
        seen.add((subscription_id, lifecycle))
        # A missed batch means changes were dropped; only a whole read recovers them.
        rescan = lifecycle == "missed"  # noqa: PLR2004 - Graph lifecycle event
        try:
            if lifecycle == "subscriptionRemoved":  # noqa: PLR2004 - Graph lifecycle event
                await _forget_channel(subscription_id, secret)
            elif await _wake(
                subscription_id,
                secret,
                CalendarProvider.MICROSOFT,
                rescan=rescan,
                renew=lifecycle == "reauthorizationRequired",  # noqa: PLR2004 - Graph lifecycle
            ):
                woken += 1
        except Exception:
            logger.opt(exception=True).warning("Microsoft push notification not processed")
    if values and not woken:
        logger.info("Microsoft push notifications ignored", count=len(values))
    return Response(status_code=status.HTTP_202_ACCEPTED)


async def _forget_channel(subscription_id: str, secret: str) -> None:
    """The next sync round opens a new subscription."""
    async with open_session() as session:
        row = await session.scalar(
            select(ConnectedCalendar).where(ConnectedCalendar.push_channel_id == subscription_id)
        )
        if row is None or not row.push_secret_digest:
            return
        if not hmac.compare_digest(row.push_secret_digest, secret_digest(secret)):
            return
        row.push_channel_id = None
        row.push_resource_id = None
        row.push_secret_digest = None
        row.push_expires_at = None
        row.next_sync_at = datetime.now(UTC)
        await session.commit()
