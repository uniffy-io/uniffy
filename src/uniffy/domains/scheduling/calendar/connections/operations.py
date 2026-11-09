"""A member's connected accounts: which calendars sync and how, pause, disconnect, sync now."""

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.membership import get_active_membership
from uniffy.core.errors import (
    MembershipRequiredError,
    NotFoundError,
    ValidationError,
)
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.connection import (
    WRITABLE_ROLES,
    CalendarConnection,
    ConnectedCalendar,
    ConnectedCalendarState,
    ConnectionStatus,
    SyncDirection,
)
from uniffy.core.models.calendar.provider_push import CalendarProviderPush, PushState
from uniffy.core.rate_limit import check_rate_limit
from uniffy.core.types import CalendarType
from uniffy.domains.scheduling.calendar.connections.cleanup import enqueue_cleanup, seal_cleanup
from uniffy.domains.scheduling.calendar.connections.reattach import reattach_calendar
from uniffy.domains.scheduling.calendar.policy import (
    ResolvedCalendarPolicy,
    policy_admits_sync,
    resolve_calendar_policy,
)

_SYNC_NOW_LIMIT = 1
_SYNC_NOW_WINDOW_SECONDS = 60


@dataclass(frozen=True)
class ConnectionView:
    connection: CalendarConnection
    calendars: list[ConnectedCalendar]
    writes_enabled: bool
    # The organization still lets this member sync; false reads as paused by policy.
    policy_allows: bool


async def require_member(session: AsyncSession, user_id: UUID, organization_id: UUID) -> None:
    if await get_active_membership(session, user_id, organization_id) is None:
        raise MembershipRequiredError("Requires organization membership")


async def list_connections(
    session: AsyncSession, user_id: UUID, organization_id: UUID
) -> tuple[list[ConnectionView], ResolvedCalendarPolicy, bool]:
    """The caller's own accounts only; an admin sees nobody else's."""
    await require_member(session, user_id, organization_id)
    policy = await resolve_calendar_policy(session, organization_id)
    connections = list(
        (
            await session.execute(
                select(CalendarConnection)
                .where(
                    CalendarConnection.organization_id == organization_id,
                    CalendarConnection.owner_id == user_id,
                    CalendarConnection.status != ConnectionStatus.DISCONNECTED,
                )
                .order_by(CalendarConnection.created_at)
            )
        ).scalars()
    )
    calendars = await _calendars_of(session, [row.id for row in connections])
    writes = policy.provider_writes_enabled()
    allowed = await policy_admits_sync(session, policy, user_id)
    views = [ConnectionView(row, calendars.get(row.id, []), writes, allowed) for row in connections]
    return views, policy, allowed


async def _calendars_of(
    session: AsyncSession, connection_ids: list[UUID]
) -> dict[UUID, list[ConnectedCalendar]]:
    if not connection_ids:
        return {}
    rows = (
        await session.execute(
            select(ConnectedCalendar)
            .where(
                ConnectedCalendar.connection_id.in_(connection_ids),
                ConnectedCalendar.state != ConnectedCalendarState.REMOVED,
            )
            .order_by(ConnectedCalendar.is_primary.desc(), ConnectedCalendar.name)
        )
    ).scalars()
    grouped: dict[UUID, list[ConnectedCalendar]] = {}
    for row in rows:
        grouped.setdefault(row.connection_id, []).append(row)
    return grouped


async def get_view(
    session: AsyncSession, user_id: UUID, organization_id: UUID, connection_id: UUID
) -> ConnectionView:
    connection = await _owned(session, user_id, organization_id, connection_id)
    policy = await resolve_calendar_policy(session, organization_id)
    calendars = await _calendars_of(session, [connection.id])
    return ConnectionView(
        connection,
        calendars.get(connection.id, []),
        policy.provider_writes_enabled(),
        await policy_admits_sync(session, policy, user_id),
    )


async def _owned(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    connection_id: UUID,
    *,
    lock: bool = False,
) -> CalendarConnection:
    await require_member(session, user_id, organization_id)
    statement = select(CalendarConnection).where(
        CalendarConnection.id == connection_id,
        CalendarConnection.organization_id == organization_id,
        CalendarConnection.owner_id == user_id,
        CalendarConnection.status != ConnectionStatus.DISCONNECTED,
    )
    if lock:
        statement = statement.with_for_update()
    connection = await session.scalar(statement)
    if connection is None:
        # The same answer for someone else's id as for a missing one.
        raise NotFoundError("Calendar connection", str(connection_id))
    return connection


def can_write(row: ConnectedCalendar, writes_enabled: bool) -> bool:
    return writes_enabled and row.access_role in WRITABLE_ROLES


async def update_connected_calendar(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    connected_calendar_id: UUID,
    *,
    sync_enabled: bool | None,
    direction: SyncDirection | None,
    counts_as_busy: bool | None,
) -> UUID:
    await require_member(session, user_id, organization_id)
    row = await session.scalar(
        select(ConnectedCalendar)
        .join(CalendarConnection, CalendarConnection.id == ConnectedCalendar.connection_id)
        .where(
            ConnectedCalendar.id == connected_calendar_id,
            ConnectedCalendar.organization_id == organization_id,
            CalendarConnection.owner_id == user_id,
            CalendarConnection.organization_id == organization_id,
            CalendarConnection.status != ConnectionStatus.DISCONNECTED,
            ConnectedCalendar.state == ConnectedCalendarState.ACTIVE,
        )
        .with_for_update(of=ConnectedCalendar)
    )
    if row is None:
        raise NotFoundError("Connected calendar", str(connected_calendar_id))
    policy = await resolve_calendar_policy(session, organization_id)
    changes: dict[str, object] = {}

    if direction is not None and direction != row.direction:
        if direction == SyncDirection.TWO_WAY and not can_write(
            row, policy.provider_writes_enabled()
        ):
            raise ValidationError(
                "direction", "Changes cannot flow back to this calendar; it stays read-only."
            )
        row.direction = direction
        changes["direction"] = direction.value
        if direction == SyncDirection.INBOUND:
            await _drop_pending_pushes(session, [row.id])
    if counts_as_busy is not None and counts_as_busy != row.counts_as_busy:
        row.counts_as_busy = counts_as_busy
        changes["counts_as_busy"] = counts_as_busy
    if sync_enabled is not None and sync_enabled != row.sync_enabled:
        if sync_enabled:
            await _enable(session, row, user_id, organization_id)
        else:
            await _disable(session, row)
        changes["sync_enabled"] = sync_enabled
    if changes:
        await write_audit_event(
            session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.CALENDAR_CONNECTION_UPDATED,
            resource_type=AuditResourceType.CALENDAR,
            resource_id=row.connection_id,
            details={"connected_calendar_id": str(row.id), **changes},
        )
    connection_id = row.connection_id
    await session.commit()
    return connection_id


async def _enable(
    session: AsyncSession, row: ConnectedCalendar, user_id: UUID, organization_id: UUID
) -> None:
    await reattach_calendar(session, row, user_id, organization_id)
    row.sync_enabled = True
    row.cursor = None
    row.scan_id = None
    row.consecutive_failures = 0
    row.last_error_code = None
    row.next_sync_at = datetime.now(UTC)


async def _disable(session: AsyncSession, row: ConnectedCalendar) -> None:
    row.sync_enabled = False
    row.next_sync_at = None
    await detach_calendars(session, [row])
    await _drop_pending_pushes(session, [row.id])


async def detach_calendars(session: AsyncSession, rows: list[ConnectedCalendar]) -> None:
    """The Uniffy calendar becomes an ordinary personal one and keeps every event."""
    calendar_ids = [row.calendar_id for row in rows if row.calendar_id is not None]
    if calendar_ids:
        await session.execute(
            update(Calendar)
            .where(Calendar.id.in_(calendar_ids), Calendar.calendar_type == CalendarType.CONNECTED)
            .values(calendar_type=CalendarType.PERSONAL)
        )


async def _drop_pending_pushes(session: AsyncSession, connected_calendar_ids: list[UUID]) -> None:
    if connected_calendar_ids:
        await session.execute(
            delete(CalendarProviderPush).where(
                CalendarProviderPush.connected_calendar_id.in_(connected_calendar_ids),
                CalendarProviderPush.state == PushState.PENDING,
            )
        )


async def set_paused(
    session: AsyncSession, user_id: UUID, organization_id: UUID, connection_id: UUID, *, paused: bool
) -> None:
    connection = await _owned(session, user_id, organization_id, connection_id, lock=True)
    if paused and connection.status == ConnectionStatus.ACTIVE:
        connection.status = ConnectionStatus.PAUSED
    elif not paused and connection.status == ConnectionStatus.PAUSED:
        connection.status = ConnectionStatus.ACTIVE
        connection.next_discovery_at = datetime.now(UTC)
        await _wake_calendars(session, connection.id)
    else:
        await session.rollback()
        return
    await write_audit_event(
        session,
        organization_id=organization_id,
        actor_user_id=user_id,
        action=Action.CALENDAR_CONNECTION_UPDATED,
        resource_type=AuditResourceType.CALENDAR,
        resource_id=connection.id,
        details={"status": connection.status.value},
    )
    await session.commit()


async def _wake_calendars(session: AsyncSession, connection_id: UUID) -> list[UUID]:
    rows = await session.execute(
        update(ConnectedCalendar)
        .where(
            ConnectedCalendar.connection_id == connection_id,
            ConnectedCalendar.sync_enabled.is_(True),
            ConnectedCalendar.state == ConnectedCalendarState.ACTIVE,
        )
        .values(next_sync_at=datetime.now(UTC))
        .returning(ConnectedCalendar.id)
    )
    return list(rows.scalars())


async def sync_now(
    session: AsyncSession, user_id: UUID, organization_id: UUID, connection_id: UUID
) -> list[UUID]:
    connection = await _owned(session, user_id, organization_id, connection_id, lock=True)
    if connection.status != ConnectionStatus.ACTIVE:
        raise ValidationError("connection_id", "Resume or reconnect the account first.")
    await check_rate_limit(
        key=f"rl:calendar_connection_sync:{connection.id}",
        limit=_SYNC_NOW_LIMIT,
        window_seconds=_SYNC_NOW_WINDOW_SECONDS,
        resource="calendar sync",
    )
    woken = await _wake_calendars(session, connection.id)
    await session.commit()
    return woken


async def disconnect(
    session: AsyncSession, user_id: UUID, organization_id: UUID, connection_id: UUID
) -> None:
    """Both sides keep their events; a later reconnect of the same account re-attaches them."""
    connection = await _owned(session, user_id, organization_id, connection_id, lock=True)
    rows = list(
        (
            await session.execute(
                select(ConnectedCalendar)
                .where(ConnectedCalendar.connection_id == connection.id)
                .with_for_update()
            )
        ).scalars()
    )
    sealed = await seal_cleanup(session, connection, rows)

    await detach_calendars(
        session, [row for row in rows if row.state == ConnectedCalendarState.ACTIVE]
    )
    await _drop_pending_pushes(session, [row.id for row in rows])
    for row in rows:
        if row.state == ConnectedCalendarState.ACTIVE:
            row.state = ConnectedCalendarState.DETACHED
        row.next_sync_at = None
        row.push_channel_id = None
        row.push_resource_id = None
        row.push_secret_digest = None
        row.push_expires_at = None
    connection.status = ConnectionStatus.DISCONNECTED
    connection.generation += 1
    connection.refresh_token_encrypted = None
    connection.access_token_encrypted = None
    connection.access_token_expires_at = None
    connection.next_discovery_at = None
    await write_audit_event(
        session,
        organization_id=organization_id,
        actor_user_id=user_id,
        action=Action.CALENDAR_CONNECTION_DISCONNECTED,
        resource_type=AuditResourceType.CALENDAR,
        resource_id=connection.id,
        details={"provider": connection.provider.value},
    )
    generation = connection.generation
    await session.commit()
    await enqueue_cleanup(connection_id, organization_id, generation, sealed)


async def owned_connections(
    session: AsyncSession, user_id: UUID, organization_id: UUID, calendar_ids: list[UUID]
) -> dict[UUID, tuple[ConnectedCalendar, CalendarConnection]]:
    """The provider rows behind the caller's own connected calendars, keyed by calendar."""
    if not calendar_ids:
        return {}
    rows = await session.execute(
        select(ConnectedCalendar, CalendarConnection)
        .join(CalendarConnection, CalendarConnection.id == ConnectedCalendar.connection_id)
        .where(
            ConnectedCalendar.calendar_id.in_(calendar_ids),
            CalendarConnection.owner_id == user_id,
            CalendarConnection.organization_id == organization_id,
        )
    )
    return {connected.calendar_id: (connected, connection) for connected, connection in rows.all()}
