"""Read an account's calendar list and keep the connected-calendar rows in step with it."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.calendar.connection import (
    WRITABLE_ROLES,
    CalendarConnection,
    ConnectedCalendar,
    ConnectedCalendarState,
    ConnectionStatus,
    SyncDirection,
)
from uniffy.domains.scheduling.calendar.calendars.subscribed import stage_connected_calendar
from uniffy.domains.scheduling.calendar.connections.clients import client_for
from uniffy.domains.scheduling.calendar.connections.credentials import (
    resolve_provider_credentials,
)
from uniffy.domains.scheduling.calendar.connections.operations import detach_calendars
from uniffy.domains.scheduling.calendar.connections.providers.base import (
    ProviderCalendarInfo,
    ProviderError,
    ReauthRequired,
)
from uniffy.domains.scheduling.calendar.connections.reattach import DEFAULT_COLOR
from uniffy.domains.scheduling.calendar.connections.run import publish_calendar_changed
from uniffy.domains.scheduling.calendar.connections.state import (
    DISCOVERY_INTERVAL,
    PAUSED_RECHECK,
    owned_by_live_member,
)
from uniffy.domains.scheduling.calendar.connections.tokens import (
    ConnectionGone,
    access_token_for,
    require_reauth,
)
from uniffy.domains.scheduling.calendar.policy import policy_admits_sync, resolve_calendar_policy
from uniffy.infrastructure.outbound import ApiError

logger = logger.bind(component="scheduling.calendar.connections.discovery")

_RETRY = timedelta(minutes=5)


async def run_discovery(
    session: AsyncSession, connection_id: UUID, generation: int
) -> dict[str, object]:
    """Returns the connected-calendar ids that start syncing now."""
    connection = await session.scalar(
        owned_by_live_member(select(CalendarConnection)).where(
            CalendarConnection.id == connection_id,
            CalendarConnection.generation == generation,
        )
    )
    if connection is None:
        await session.rollback()
        return {"status": "skipped"}
    policy = await resolve_calendar_policy(session, connection.organization_id)
    if not await policy_admits_sync(session, policy, connection.owner_id):
        connection.next_discovery_at = datetime.now(UTC) + PAUSED_RECHECK
        await session.commit()
        return {"status": "paused"}
    await session.rollback()
    try:
        access = await access_token_for(session, connection_id, generation)
    except ConnectionGone:
        return {"status": "skipped"}
    except ReauthRequired:
        return {"status": "reauth_required"}
    except ProviderError, ApiError:
        await _retry_later(session, connection_id)
        return {"status": "failed"}
    connection = await session.get(CalendarConnection, connection_id)
    if connection is None:
        return {"status": "skipped"}
    credentials = await resolve_provider_credentials(
        session, connection.organization_id, connection.provider
    )
    await session.rollback()
    if credentials is None:
        return {"status": "skipped"}
    try:
        found = await client_for(credentials).list_calendars(access.token)
    except ReauthRequired:
        await require_reauth(session, connection_id, generation, "unauthorized")
        return {"status": "reauth_required"}
    except (ProviderError, ApiError) as exc:
        logger.info(
            "Calendar list could not be read",
            connection_id=str(connection_id),
            reason=getattr(exc, "failure", None) or getattr(exc, "reason", None),
        )
        await _retry_later(session, connection_id)
        return {"status": "failed"}

    connection = await session.scalar(
        select(CalendarConnection)
        .where(
            CalendarConnection.id == connection_id,
            CalendarConnection.generation == generation,
            CalendarConnection.status == ConnectionStatus.ACTIVE,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if connection is None:
        await session.rollback()
        return {"status": "skipped"}
    started, changed_calendars = await _reconcile(session, connection, found)
    connection.next_discovery_at = datetime.now(UTC) + DISCOVERY_INTERVAL
    organization_id = connection.organization_id
    await session.commit()
    for calendar_id in changed_calendars:
        await publish_calendar_changed(calendar_id, organization_id)
    return {"status": "ok", "calendars": len(found), "started": [str(i) for i in started]}


async def _reconcile(
    session: AsyncSession, connection: CalendarConnection, found: list[ProviderCalendarInfo]
) -> tuple[list[UUID], list[UUID]]:
    existing = {
        row.provider_calendar_id: row
        for row in (
            await session.execute(
                select(ConnectedCalendar)
                .where(ConnectedCalendar.connection_id == connection.id)
                .with_for_update()
            )
        ).scalars()
    }
    policy = await resolve_calendar_policy(session, connection.organization_id)
    writes = policy.provider_writes_enabled()
    now = datetime.now(UTC)
    started: list[UUID] = []
    changed: list[UUID] = []
    seen: set[str] = set()
    for info in found:
        seen.add(info.provider_calendar_id)
        row = existing.get(info.provider_calendar_id)
        writable = info.access_role in WRITABLE_ROLES
        if row is None:
            row = ConnectedCalendar(
                connection_id=connection.id,
                organization_id=connection.organization_id,
                provider_calendar_id=info.provider_calendar_id[:500],
                name=info.name,
                provider_color=info.color,
                access_role=info.access_role,
                is_primary=info.is_primary,
                is_system=info.is_system,
                # Only the main calendar starts syncing; the member opts into the rest.
                sync_enabled=info.is_primary,
                direction=SyncDirection.TWO_WAY if writable and writes else SyncDirection.INBOUND,
                counts_as_busy=info.is_primary,
            )
            session.add(row)
            await session.flush()
            if row.sync_enabled:
                calendar = await stage_connected_calendar(
                    session,
                    connection.owner_id,
                    connection.organization_id,
                    info.name,
                    info.color or DEFAULT_COLOR,
                )
                row.calendar_id = calendar.id
                row.next_sync_at = now
                started.append(row.id)
            continue
        row.name = info.name
        row.provider_color = info.color
        row.access_role = info.access_role
        row.is_primary = info.is_primary
        row.is_system = info.is_system
        if not writable and row.direction == SyncDirection.TWO_WAY:
            row.direction = SyncDirection.INBOUND
        if row.state == ConnectedCalendarState.REMOVED:
            row.state = ConnectedCalendarState.ACTIVE
            row.cursor = None
            if row.sync_enabled and row.calendar_id is not None:
                row.sync_enabled = False
    vanished = [
        row
        for provider_id, row in existing.items()
        if provider_id not in seen and row.state == ConnectedCalendarState.ACTIVE
    ]
    for row in vanished:
        row.state = ConnectedCalendarState.REMOVED
        row.next_sync_at = None
        if row.calendar_id is not None:
            changed.append(row.calendar_id)
    await detach_calendars(session, vanished)
    return started, changed


async def _retry_later(session: AsyncSession, connection_id: UUID) -> None:
    connection = await session.scalar(
        select(CalendarConnection).where(CalendarConnection.id == connection_id).with_for_update()
    )
    if connection is not None:
        connection.next_discovery_at = datetime.now(UTC) + _RETRY
    await session.commit()
