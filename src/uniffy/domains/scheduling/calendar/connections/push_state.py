"""The push outbox row's life: claimed once, then done, retried with backoff, or failed."""

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from uniffy.core.models.calendar.connection import (
    CalendarConnection,
    CalendarProvider,
    ConnectedCalendar,
    ConnectedCalendarState,
    ConnectionStatus,
    SyncDirection,
    SyncFailure,
)
from uniffy.core.models.calendar.provider_push import (
    MAX_PUSH_ATTEMPTS,
    CalendarProviderPush,
    PushOperation,
    PushState,
)
from uniffy.domains.scheduling.calendar.connections.providers.base import ProviderError
from uniffy.domains.scheduling.calendar.connections.run import publish_calendar_changed
from uniffy.domains.scheduling.calendar.connections.state import owned_by_live_member
from uniffy.domains.scheduling.calendar.policy import policy_admits_sync, resolve_calendar_policy

logger = logger.bind(component="scheduling.calendar.connections.push_state")

REAUTH_WAIT = timedelta(hours=1)
_BASE_BACKOFF = timedelta(minutes=1)
_MAX_BACKOFF = timedelta(hours=1)
# Longer than any push job runs; a row in flight past it belongs to a worker that died.
IN_FLIGHT_LEASE = timedelta(minutes=10)
_BEHIND_ANOTHER = timedelta(seconds=30)
SUPERSEDED = "superseded"


@dataclass(frozen=True)
class PushClaim:
    push_id: UUID
    organization_id: UUID
    event_id: UUID
    connected_calendar_id: UUID
    actor_id: UUID | None
    operation: PushOperation
    occurrence_date: date | None
    provider_event_id: str | None
    attempts: int
    generation: int


@dataclass(frozen=True)
class PushTarget:
    connection_id: UUID
    owner_id: UUID
    provider: CalendarProvider
    provider_calendar_id: str
    calendar_id: UUID | None


async def claim_push(session: AsyncSession, push_id: UUID, generation: int) -> PushClaim | None:
    identity = (
        await session.execute(
            select(CalendarProviderPush.event_id, CalendarProviderPush.connected_calendar_id).where(
                CalendarProviderPush.id == push_id
            )
        )
    ).first()
    if identity is None:
        await session.rollback()
        return None
    await session.execute(
        select(
            func.pg_advisory_xact_lock(
                func.hashtextextended(
                    f"calendar-push:{identity.event_id}:{identity.connected_calendar_id}", 0
                )
            )
        )
    )
    # One write per event and calendar at a time: a second one would read a stale etag and
    # mistake the first for a provider edit, and a delete must wait for the create it undoes.
    other = aliased(CalendarProviderPush)
    busy = (
        select(other.id)
        .where(
            other.event_id == CalendarProviderPush.event_id,
            other.connected_calendar_id == CalendarProviderPush.connected_calendar_id,
            other.id != CalendarProviderPush.id,
            other.state == PushState.IN_FLIGHT,
            other.updated_at > datetime.now(UTC) - IN_FLIGHT_LEASE,
        )
        .exists()
    )
    row = (
        await session.execute(
            update(CalendarProviderPush)
            .where(
                CalendarProviderPush.id == push_id,
                CalendarProviderPush.state == PushState.PENDING,
                CalendarProviderPush.generation == generation,
                ~busy,
            )
            .values(
                state=PushState.IN_FLIGHT,
                attempts=CalendarProviderPush.attempts + 1,
                updated_at=datetime.now(UTC),
            )
            .returning(
                CalendarProviderPush.id,
                CalendarProviderPush.organization_id,
                CalendarProviderPush.event_id,
                CalendarProviderPush.connected_calendar_id,
                CalendarProviderPush.actor_id,
                CalendarProviderPush.operation,
                CalendarProviderPush.occurrence_date,
                CalendarProviderPush.provider_event_id,
                CalendarProviderPush.attempts,
                CalendarProviderPush.generation,
            )
        )
    ).first()
    if row is None:
        # Waiting behind another write to the same event; try again shortly.
        await session.execute(
            update(CalendarProviderPush)
            .where(
                CalendarProviderPush.id == push_id,
                CalendarProviderPush.state == PushState.PENDING,
            )
            .values(next_attempt_at=datetime.now(UTC) + _BEHIND_ANOTHER)
        )
        await session.commit()
        return None
    await session.commit()
    return PushClaim(
        push_id=row[0],
        organization_id=row[1],
        event_id=row[2],
        connected_calendar_id=row[3],
        actor_id=row[4],
        operation=PushOperation(row[5]),
        occurrence_date=row[6],
        provider_event_id=row[7],
        attempts=row[8],
        generation=row[9],
    )


async def push_target(session: AsyncSession, claim: PushClaim) -> PushTarget | None:
    row = (
        await session.execute(
            owned_by_live_member(
                select(ConnectedCalendar, CalendarConnection).join(
                    CalendarConnection, CalendarConnection.id == ConnectedCalendar.connection_id
                )
            ).where(
                ConnectedCalendar.id == claim.connected_calendar_id,
                ConnectedCalendar.state == ConnectedCalendarState.ACTIVE,
                ConnectedCalendar.direction == SyncDirection.TWO_WAY,
                CalendarConnection.generation == claim.generation,
            )
        )
    ).first()
    policy = await resolve_calendar_policy(session, claim.organization_id)
    # The owner's account writes, so the owner must still be allowed to sync at all.
    if (
        row is None
        or not policy.provider_writes_enabled()
        or not await policy_admits_sync(session, policy, row[1].owner_id)
    ):
        await session.rollback()
        return None
    connected, connection = row
    target = PushTarget(
        connection_id=connection.id,
        owner_id=connection.owner_id,
        provider=connection.provider,
        provider_calendar_id=connected.provider_calendar_id,
        calendar_id=connected.calendar_id,
    )
    await session.rollback()
    return target


async def held_for_pause(session: AsyncSession, claim: PushClaim) -> bool:
    """A paused account keeps its pushes; the dispatcher sends them once it resumes."""
    paused = await session.scalar(
        select(CalendarConnection.id)
        .join(ConnectedCalendar, ConnectedCalendar.connection_id == CalendarConnection.id)
        .where(
            ConnectedCalendar.id == claim.connected_calendar_id,
            CalendarConnection.generation == claim.generation,
            CalendarConnection.status == ConnectionStatus.PAUSED,
        )
    )
    if paused is None:
        await session.rollback()
        return False
    await session.execute(
        update(CalendarProviderPush)
        .where(
            CalendarProviderPush.id == claim.push_id,
            CalendarProviderPush.state == PushState.IN_FLIGHT,
        )
        .values(
            state=PushState.PENDING,
            # Waiting out a pause is not a failed attempt.
            attempts=CalendarProviderPush.attempts - 1,
            next_attempt_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
    )
    await session.commit()
    return True


def failure_of(exc: Exception) -> SyncFailure:
    return exc.failure if isinstance(exc, ProviderError) else SyncFailure.UNREACHABLE


async def finish_push(
    session: AsyncSession, claim: PushClaim, state: PushState, *, error: str | None = None
) -> None:
    await session.execute(
        update(CalendarProviderPush)
        .where(CalendarProviderPush.id == claim.push_id)
        .values(state=state, last_error_code=error, updated_at=datetime.now(UTC))
    )
    await session.commit()


async def retry_push(
    session: AsyncSession,
    claim: PushClaim,
    failure: SyncFailure,
    *,
    wait: timedelta | None = None,
    retry_after: float | None = None,
) -> None:
    await session.rollback()
    if claim.attempts >= MAX_PUSH_ATTEMPTS and failure != SyncFailure.REAUTH_REQUIRED:
        await finish_push(session, claim, PushState.FAILED, error=failure.value)
        return
    delay = wait or min(_BASE_BACKOFF * (2 ** min(max(0, claim.attempts - 1), 16)), _MAX_BACKOFF)
    if retry_after:
        delay = max(delay, timedelta(seconds=min(retry_after, _MAX_BACKOFF.total_seconds())))
    newer = await session.scalar(
        select(CalendarProviderPush.id)
        .where(
            CalendarProviderPush.event_id == claim.event_id,
            CalendarProviderPush.connected_calendar_id == claim.connected_calendar_id,
            CalendarProviderPush.operation == claim.operation,
            CalendarProviderPush.occurrence_date.is_not_distinct_from(claim.occurrence_date),
            CalendarProviderPush.state == PushState.PENDING,
        )
        .limit(1)
    )
    if newer is not None:
        # A later edit is already queued and carries the event as it is now.
        await finish_push(session, claim, PushState.DONE, error=SUPERSEDED)
        return
    await session.execute(
        update(CalendarProviderPush)
        .where(
            CalendarProviderPush.id == claim.push_id,
            CalendarProviderPush.state == PushState.IN_FLIGHT,
        )
        .values(
            state=PushState.PENDING,
            next_attempt_at=datetime.now(UTC) + delay,
            last_error_code=failure.value,
            updated_at=datetime.now(UTC),
        )
    )
    await session.commit()


async def refused_push(
    session: AsyncSession, claim: PushClaim, target: PushTarget, exc: ProviderError
) -> dict[str, object]:
    await session.rollback()
    logger.info(
        "Calendar push refused",
        push_id=str(claim.push_id),
        operation=claim.operation.value,
        failure=exc.failure.value,
        status=exc.status,
        attempts=claim.attempts,
    )
    if exc.failure == SyncFailure.NOT_FOUND:
        # Gone on the provider; the next inbound round removes it here too.
        await finish_push(session, claim, PushState.DONE, error=exc.failure.value)
        return {"status": "done"}
    if exc.failure == SyncFailure.UNPROCESSABLE:
        # The same change would be refused the same way on every attempt.
        await finish_push(session, claim, PushState.FAILED, error=exc.failure.value)
        return {"status": "failed", "failure": exc.failure.value}
    if exc.failure == SyncFailure.PERMISSION_DENIED:
        await finish_push(session, claim, PushState.FAILED, error=exc.failure.value)
        await session.execute(
            update(ConnectedCalendar)
            .where(ConnectedCalendar.id == claim.connected_calendar_id)
            .values(direction=SyncDirection.INBOUND, last_error_code=SyncFailure.PERMISSION_DENIED)
        )
        await session.commit()
        if target.calendar_id is not None:
            await publish_calendar_changed(target.calendar_id, claim.organization_id)
        return {"status": "failed", "failure": exc.failure.value}
    if exc.failure == SyncFailure.REAUTH_REQUIRED:
        await retry_push(session, claim, exc.failure, wait=REAUTH_WAIT)
        return {"status": "waiting"}
    await retry_push(session, claim, exc.failure, retry_after=exc.retry_after)
    if claim.attempts >= MAX_PUSH_ATTEMPTS:
        await session.execute(
            update(ConnectedCalendar)
            .where(ConnectedCalendar.id == claim.connected_calendar_id)
            .values(last_error_code=exc.failure, last_error_status=exc.status)
        )
        await session.commit()
    return {"status": "retry", "failure": exc.failure.value}
