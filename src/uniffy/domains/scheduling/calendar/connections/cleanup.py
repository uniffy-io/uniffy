"""Provider cleanup after a committed disconnect, fenced against a later reconnect."""

from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.crypto.org_cipher import OrgCipher
from uniffy.core.jobs import JobEnqueueOutcome, enqueue_job_reconnecting
from uniffy.core.json_codec import dumps_str, loads
from uniffy.core.models.calendar.connection import (
    CalendarConnection,
    ConnectedCalendar,
    ConnectionStatus,
)
from uniffy.domains.scheduling.calendar.connections.channels import ChannelRef, stop_channels
from uniffy.domains.scheduling.calendar.connections.clients import client_for
from uniffy.domains.scheduling.calendar.connections.credentials import resolve_provider_credentials
from uniffy.domains.scheduling.calendar.jobs.contracts import CLEANUP_CALENDAR_CONNECTION

logger = logger.bind(component="scheduling.calendar.connections.cleanup")
_CLEANUP_QUEUE_LIFETIME_SECONDS = 600


class CleanupStatus(StrEnum):
    DONE = "done"
    SKIPPED = "skipped"
    FAILED = "failed"


async def seal_cleanup(
    session: AsyncSession, connection: CalendarConnection, rows: list[ConnectedCalendar]
) -> str | None:
    if not connection.access_token_encrypted and not connection.refresh_token_encrypted:
        return None
    return await OrgCipher(session).encrypt(
        connection.organization_id,
        dumps_str({
            "client_fingerprint": connection.client_fingerprint,
            "access_token_encrypted": connection.access_token_encrypted,
            "refresh_token_encrypted": connection.refresh_token_encrypted,
            "access_token_expires_at": (
                connection.access_token_expires_at.isoformat()
                if connection.access_token_expires_at
                else None
            ),
            "channels": [
                {"channel_id": row.push_channel_id, "resource_id": row.push_resource_id}
                for row in rows
                if row.push_channel_id
            ],
        }),
    )


async def enqueue_cleanup(
    connection_id: UUID, organization_id: UUID, generation: int, sealed: str | None
) -> None:
    if sealed is None:
        return
    try:
        result = await enqueue_job_reconnecting(
            CLEANUP_CALENDAR_CONNECTION,
            str(connection_id),
            str(organization_id),
            generation,
            sealed,
            _job_id=f"calendar-disconnect:{connection_id}:{generation}",
            _expires=_CLEANUP_QUEUE_LIFETIME_SECONDS,
        )
        if result.outcome not in (JobEnqueueOutcome.ENQUEUED, JobEnqueueOutcome.DEDUPLICATED):
            logger.warning(
                "Calendar provider cleanup was not queued", connection_id=str(connection_id)
            )
    except Exception as exc:
        logger.warning("Calendar provider cleanup queue unavailable", error_type=type(exc).__name__)


async def run_cleanup(
    session: AsyncSession, connection_id: UUID, organization_id: UUID, generation: int, sealed: str
) -> CleanupStatus:
    connection = await session.scalar(
        select(CalendarConnection).where(
            CalendarConnection.id == connection_id,
            CalendarConnection.organization_id == organization_id,
            CalendarConnection.generation == generation,
            CalendarConnection.status == ConnectionStatus.DISCONNECTED,
        )
    )
    if connection is None:
        await session.rollback()
        return CleanupStatus.SKIPPED
    credentials = await resolve_provider_credentials(session, organization_id, connection.provider)
    cipher = OrgCipher(session)
    payload = loads(await cipher.decrypt(organization_id, sealed))
    if credentials is None or credentials.fingerprint != payload["client_fingerprint"]:
        await session.rollback()
        return CleanupStatus.SKIPPED
    refresh_token = (
        await cipher.decrypt(organization_id, payload["refresh_token_encrypted"])
        if payload["refresh_token_encrypted"]
        else None
    )
    expiry = payload["access_token_expires_at"]
    access_token = (
        await cipher.decrypt(organization_id, payload["access_token_encrypted"])
        if payload["access_token_encrypted"]
        and expiry
        and datetime.fromisoformat(expiry) > datetime.now(UTC)
        else None
    )
    channels = [ChannelRef(**item) for item in payload["channels"]]
    await session.rollback()
    client = client_for(credentials)
    if access_token is not None and channels:
        await stop_channels(client, access_token, channels)
    if refresh_token is not None:
        try:
            await client.revoke(refresh_token)
        except Exception:
            logger.warning("Calendar token revoke failed", provider=credentials.provider.value)
            return CleanupStatus.FAILED
    return CleanupStatus.DONE
