"""Provider change notifications: opened, renewed before they lapse, and stopped on disconnect."""

import hashlib
import os
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.calendar.connection import CalendarProvider, ConnectedCalendar
from uniffy.domains.scheduling.calendar.connections.providers.base import (
    ProviderError,
    PushUnsupported,
)
from uniffy.domains.scheduling.calendar.connections.providers.google import GoogleCalendarClient
from uniffy.domains.scheduling.calendar.connections.providers.microsoft import (
    MicrosoftCalendarClient,
)

logger = logger.bind(component="scheduling.calendar.connections.channels")

PUSH_BASE_ENV = "CALENDAR_PUSH_BASE_URL"
RENEW_BEFORE = timedelta(hours=24)
UNSUPPORTED_BACKOFF = timedelta(days=7)
# Paths inside the calendar router; the full address adds where that router is mounted.
GOOGLE_PUSH_PATH = "/push/google"
MICROSOFT_PUSH_PATH = "/push/microsoft"
_ROUTER_MOUNT = "/api/calendar"
_PATHS = {
    CalendarProvider.GOOGLE: f"{_ROUTER_MOUNT}{GOOGLE_PUSH_PATH}",
    CalendarProvider.MICROSOFT: f"{_ROUTER_MOUNT}{MICROSOFT_PUSH_PATH}",
}


def push_address(provider: CalendarProvider) -> str | None:
    """Providers only deliver to public https; without one, polling alone keeps calendars current."""
    base = (os.getenv(PUSH_BASE_ENV) or os.getenv("UNIFFY_BASE_URL") or "").strip().rstrip("/")
    parts = urlsplit(base)
    if parts.scheme != "https" or not parts.hostname:  # noqa: PLR2004 - URL scheme
        return None
    if parts.hostname in ("localhost", "127.0.0.1"):  # noqa: PLR2004 - loopback hosts
        return None
    return f"{base}{_PATHS[provider]}"


def secret_digest(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


@dataclass(frozen=True)
class ChannelRef:
    channel_id: str
    resource_id: str | None

    @classmethod
    def of(cls, row: ConnectedCalendar) -> ChannelRef:
        return cls(row.push_channel_id or "", row.push_resource_id)


async def stop_channels(
    client: GoogleCalendarClient | MicrosoftCalendarClient, token: str, refs: list[ChannelRef]
) -> None:
    for ref in refs:
        if not ref.channel_id:
            continue
        try:
            await client.stop_channel(token, ref.channel_id, ref.resource_id)
        except Exception:
            # An unstopped channel lapses on its own; its notifications find no calendar.
            logger.warning("Calendar push channel not stopped", provider=client.provider.value)


async def ensure_channel(
    session: AsyncSession,
    client: GoogleCalendarClient | MicrosoftCalendarClient,
    token: str,
    connected_calendar_id: UUID,
) -> None:
    """Runs after a successful sync, outside its transaction; a failure leaves polling in charge."""
    address = push_address(client.provider)
    if address is None:
        return
    row = await session.get(ConnectedCalendar, connected_calendar_id)
    if row is None:
        return
    now = datetime.now(UTC)
    if row.push_unsupported_until and row.push_unsupported_until > now:
        return
    if row.push_channel_id and row.push_expires_at and row.push_expires_at - RENEW_BEFORE > now:
        return
    old = ChannelRef.of(row) if row.push_channel_id else None
    provider_calendar_id = row.provider_calendar_id
    await session.rollback()

    try:
        if old is not None and isinstance(client, MicrosoftCalendarClient):
            expires_at = await client.renew_channel(token, old.channel_id)
            await _store(
                session, connected_calendar_id, old.channel_id, old.resource_id, None, expires_at
            )
            return
        secret = secrets.token_urlsafe(32)
        channel = await client.watch(
            token,
            provider_calendar_id,
            channel_id=str(uuid.uuid4()),
            address=address,
            secret=secret,
        )
    except PushUnsupported:
        await _mark_unsupported(session, connected_calendar_id, now + UNSUPPORTED_BACKOFF)
        return
    except ProviderError as exc:
        logger.info(
            "Calendar push channel not opened; polling continues",
            connected_calendar_id=str(connected_calendar_id),
            failure=exc.failure.value,
            status=exc.status,
        )
        if old is not None and isinstance(client, MicrosoftCalendarClient):
            # A subscription that cannot be renewed is gone; the next round opens a new one.
            await _store(session, connected_calendar_id, None, None, None, None)
        return
    await _store(
        session,
        connected_calendar_id,
        channel.channel_id,
        channel.resource_id,
        secret_digest(secret),
        channel.expires_at,
    )
    # Only once the new channel exists, so no change falls into a gap between them.
    if old is not None:
        await stop_channels(client, token, [old])


async def _store(
    session: AsyncSession,
    connected_calendar_id: UUID,
    channel_id: str | None,
    resource_id: str | None,
    digest: str | None,
    expires_at: datetime | None,
) -> None:
    row = await session.scalar(
        select(ConnectedCalendar)
        .where(ConnectedCalendar.id == connected_calendar_id)
        .with_for_update()
    )
    if row is None:
        await session.rollback()
        return
    row.push_channel_id = channel_id
    row.push_resource_id = resource_id
    if digest is not None or channel_id is None:
        row.push_secret_digest = digest
    row.push_expires_at = expires_at
    await session.commit()


async def _mark_unsupported(
    session: AsyncSession, connected_calendar_id: UUID, until: datetime
) -> None:
    row = await session.scalar(
        select(ConnectedCalendar)
        .where(ConnectedCalendar.id == connected_calendar_id)
        .with_for_update()
    )
    if row is None:
        await session.rollback()
        return
    row.push_unsupported_until = until
    row.push_channel_id = None
    row.push_resource_id = None
    row.push_secret_digest = None
    row.push_expires_at = None
    await session.commit()
