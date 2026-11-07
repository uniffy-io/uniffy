"""One sync round of one connected calendar: read the provider with no lock held, then write."""

import traceback
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from uuid import UUID

from loguru import logger
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.events.realtime import publish_content_changed
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.connection import (
    CalendarConnection,
    CalendarProvider,
    ConnectedCalendar,
    ConnectedCalendarState,
    ConnectionStatus,
    SyncFailure,
)
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.link import CalendarEventLink
from uniffy.core.outbound import ApiError
from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.types import CalendarType, ContentType
from uniffy.domains.scheduling.calendar.calendars.search import remove_event_documents
from uniffy.domains.scheduling.calendar.connections.channels import ensure_channel
from uniffy.domains.scheduling.calendar.connections.clients import ProviderClient, client_for
from uniffy.domains.scheduling.calendar.connections.credentials import (
    resolve_provider_credentials,
)
from uniffy.domains.scheduling.calendar.connections.identity import member_emails
from uniffy.domains.scheduling.calendar.connections.normalize import ChangeBatch, ItemKind
from uniffy.domains.scheduling.calendar.connections.providers.base import (
    CursorExpired,
    ProviderError,
    ReauthRequired,
    SyncTarget,
)
from uniffy.domains.scheduling.calendar.connections.recurrence import series_rule
from uniffy.domains.scheduling.calendar.connections.state import (
    PAUSED_RECHECK,
    next_after_failure,
    next_after_success,
    owned_by_live_member,
)
from uniffy.domains.scheduling.calendar.connections.sync import (
    SyncOutcome,
    SyncTargetRow,
    stage_provider_changes,
)
from uniffy.domains.scheduling.calendar.connections.tokens import (
    ConnectionGone,
    access_token_for,
    require_reauth,
)
from uniffy.domains.scheduling.calendar.policy import (
    policy_admits_sync,
    provider_deployment,
    resolve_calendar_policy,
)
from uniffy.domains.scheduling.calendar.search import (
    FeedEventProjection,
    refresh_event_search_projection,
)

logger = logger.bind(component="scheduling.calendar.connections.run")

WINDOW_BACK = timedelta(days=365)
WINDOW_FORWARD = timedelta(days=730)
# The window reaches this far past the horizon, so a full rescan comes about every two months.
_WINDOW_SLACK = timedelta(days=30)
_PROJECTION_CHUNK = 500


class SyncStatus(StrEnum):
    SYNCED = "synced"
    UNCHANGED = "unchanged"
    FAILED = "failed"
    PAUSED = "paused"
    SKIPPED = "skipped"


@dataclass(frozen=True)
class SyncReport:
    status: SyncStatus
    created: int = 0
    updated: int = 0
    deleted: int = 0
    failure: SyncFailure | None = None

    def as_dict(self) -> dict[str, object]:
        report: dict[str, object] = {"status": self.status.value}
        if self.status == SyncStatus.SYNCED:
            report.update(created=self.created, updated=self.updated, deleted=self.deleted)
        if self.failure is not None:
            report["failure"] = self.failure.value
        return report


@dataclass(frozen=True)
class _Source:
    connected_calendar_id: UUID
    connection_id: UUID
    organization_id: UUID
    owner_id: UUID
    calendar_id: UUID
    provider: CalendarProvider
    generation: int
    target: SyncTarget
    full_reason: str | None


def desired_window(now: datetime) -> tuple[datetime, datetime]:
    start = (now - WINDOW_BACK).replace(hour=0, minute=0, second=0, microsecond=0)
    # Reach a month past the horizon, so the window holds for weeks before it has to move.
    horizon = now + WINDOW_FORWARD + _WINDOW_SLACK
    # The first of the month after that.
    month_end = (horizon.replace(day=28) + timedelta(days=4)).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    )
    return start, month_end


async def run_sync(
    session: AsyncSession,
    connected_calendar_id: UUID,
    generation: int,
    search_indexer: SearchIndexer,
) -> SyncReport:
    source = await _load(session, connected_calendar_id, generation)
    if isinstance(source, SyncReport):
        return source
    try:
        access = await access_token_for(session, source.connection_id, source.generation)
    except ConnectionGone:
        return SyncReport(SyncStatus.SKIPPED)
    except ReauthRequired:
        return SyncReport(SyncStatus.FAILED, failure=SyncFailure.REAUTH_REQUIRED)
    except (ProviderError, ApiError) as exc:
        return await _record_failure(session, source, _failure_of(exc))

    credentials = await resolve_provider_credentials(
        session, source.organization_id, source.provider
    )
    await session.rollback()
    if credentials is None:
        return SyncReport(SyncStatus.SKIPPED)
    client = client_for(credentials)
    try:
        batch = await _fetch(client, access.token, source, access.account_email)
    except ReauthRequired:
        await require_reauth(session, source.connection_id, source.generation, "unauthorized")
        return SyncReport(SyncStatus.FAILED, failure=SyncFailure.REAUTH_REQUIRED)
    except (ProviderError, ApiError) as exc:
        return await _record_failure(session, source, _failure_of(exc))

    members = await member_emails(session, source.organization_id)
    row = await _lock_unchanged(session, source)
    if row is None:
        return SyncReport(SyncStatus.SKIPPED)
    scan_id = uuid.uuid4() if batch.full_scan else None
    try:
        outcome = await stage_provider_changes(
            session,
            SyncTargetRow(
                connected_calendar_id=row.id,
                organization_id=source.organization_id,
                owner_id=source.owner_id,
                calendar_id=source.calendar_id,
            ),
            batch,
            members=members,
            scan_id=scan_id,
            window_start=source.target.window_start,
        )
        _record_success(row, source, batch, outcome, scan_id)
        await _record_totals(session, row, source.connection_id, outcome)
        await session.commit()
    except Exception as exc:
        await session.rollback()
        logger.warning(
            "Connected calendar changes could not be stored",
            connected_calendar_id=str(connected_calendar_id),
            traceback="".join(traceback.format_exception(exc)),
        )
        return await _record_failure(session, source, ProviderError(SyncFailure.UNPROCESSABLE))

    if outcome.changed or row.search_stale:
        await _project(session, search_indexer, source, outcome)
    if outcome.changed:
        await publish_calendar_changed(source.calendar_id, source.organization_id)
    try:
        await ensure_channel(session, client, access.token, source.connected_calendar_id)
    except Exception:
        await session.rollback()
        logger.opt(exception=True).warning("Calendar push channel upkeep failed")
    logger.info(
        "Connected calendar synced",
        connected_calendar_id=str(connected_calendar_id),
        provider=source.provider.value,
        full_scan=batch.full_scan,
        # A full read the round did not plan means the provider refused the cursor.
        full_reason=source.full_reason or ("cursor_expired" if batch.full_scan else None),
        created=outcome.created,
        updated=outcome.updated,
        deleted=outcome.deleted,
        unchanged=outcome.unchanged,
        skipped=len(batch.skipped),
    )
    if not outcome.changed:
        return SyncReport(SyncStatus.UNCHANGED)
    return SyncReport(
        SyncStatus.SYNCED,
        created=outcome.created,
        updated=outcome.updated,
        deleted=outcome.deleted,
    )


async def _load(
    session: AsyncSession, connected_calendar_id: UUID, generation: int
) -> _Source | SyncReport:
    row = (
        await session.execute(
            owned_by_live_member(
                select(ConnectedCalendar, CalendarConnection)
                .join(CalendarConnection, CalendarConnection.id == ConnectedCalendar.connection_id)
                .join(Calendar, Calendar.id == ConnectedCalendar.calendar_id)
            ).where(
                ConnectedCalendar.id == connected_calendar_id,
                ConnectedCalendar.state == ConnectedCalendarState.ACTIVE,
                ConnectedCalendar.sync_enabled.is_(True),
                CalendarConnection.generation == generation,
                Calendar.is_deleted.is_(False),
                Calendar.calendar_type == CalendarType.CONNECTED,
            )
        )
    ).one_or_none()
    if row is None:
        await session.rollback()
        return SyncReport(SyncStatus.SKIPPED)
    connected, connection = row
    policy = await resolve_calendar_policy(session, connection.organization_id)
    if not provider_deployment().sync_enabled or not await policy_admits_sync(
        session, policy, connection.owner_id
    ):
        await session.execute(
            update(ConnectedCalendar)
            .where(ConnectedCalendar.id == connected.id)
            .values(next_sync_at=datetime.now(UTC) + PAUSED_RECHECK)
        )
        await session.commit()
        return SyncReport(SyncStatus.PAUSED)

    now = datetime.now(UTC)
    window_start, window_end = connected.window_start, connected.window_end
    cursor = connected.cursor
    full_reason = None if cursor else "no_cursor"
    if window_end is None or window_start is None or window_end < now + WINDOW_FORWARD:
        window_start, window_end = desired_window(now)
        if cursor:
            full_reason = "window_moved"
        cursor = None
    source = _Source(
        connected_calendar_id=connected.id,
        connection_id=connection.id,
        organization_id=connection.organization_id,
        owner_id=connection.owner_id,
        calendar_id=connected.calendar_id,  # type: ignore[arg-type]
        provider=connection.provider,
        generation=connection.generation,
        target=SyncTarget(
            provider_calendar_id=connected.provider_calendar_id,
            is_primary=connected.is_primary,
            cursor=cursor,
            window_start=window_start,
            window_end=window_end,
        ),
        full_reason=full_reason,
    )
    await session.rollback()
    return source


async def _fetch(
    client: ProviderClient, token: str, source: _Source, self_email: str
) -> ChangeBatch:
    try:
        batch = await client.fetch_changes(token, source.target, self_email)
    except CursorExpired:
        logger.info(
            "Provider forgot the sync cursor; reading the calendar whole",
            connected_calendar_id=str(source.connected_calendar_id),
        )
        target = SyncTarget(
            provider_calendar_id=source.target.provider_calendar_id,
            is_primary=source.target.is_primary,
            cursor=None,
            window_start=source.target.window_start,
            window_end=source.target.window_end,
        )
        batch = await client.fetch_changes(token, target, self_email)
    mirrored = dict(batch.mirrored)
    for item in batch.items:
        if (
            item.kind == ItemKind.MASTER
            and item.provider_event_id not in mirrored
            and series_rule(item) is None
        ):
            mirrored[item.provider_event_id] = tuple(
                await client.instances(
                    token,
                    source.target.provider_calendar_id,
                    item.provider_event_id,
                    source.target.window_start,
                    source.target.window_end,
                    self_email,
                )
            )
    if mirrored == batch.mirrored:
        return batch
    return ChangeBatch(
        items=batch.items,
        skipped=batch.skipped,
        cursor=batch.cursor,
        full_scan=batch.full_scan,
        mirrored=mirrored,
        complete_series=batch.complete_series,
    )


async def _lock_unchanged(session: AsyncSession, source: _Source) -> ConnectedCalendar | None:
    # Calendar first, as deleting it does, then the row; a change mid-fetch queued its own round.
    await session.execute(
        select(Calendar.id)
        .where(Calendar.id == source.calendar_id)
        .with_for_update(read=True, key_share=True)
    )
    row = await session.scalar(
        select(ConnectedCalendar)
        .join(CalendarConnection, CalendarConnection.id == ConnectedCalendar.connection_id)
        .where(
            ConnectedCalendar.id == source.connected_calendar_id,
            ConnectedCalendar.state == ConnectedCalendarState.ACTIVE,
            ConnectedCalendar.sync_enabled.is_(True),
            ConnectedCalendar.calendar_id == source.calendar_id,
            CalendarConnection.generation == source.generation,
            CalendarConnection.status == ConnectionStatus.ACTIVE,
        )
        .with_for_update(of=ConnectedCalendar)
        .execution_options(populate_existing=True)
    )
    if row is None:
        await session.rollback()
        return None
    if source.target.cursor is not None and row.cursor != source.target.cursor:
        await session.rollback()
        return None
    return row


def _record_success(
    row: ConnectedCalendar,
    source: _Source,
    batch: ChangeBatch,
    outcome: SyncOutcome,
    scan_id: UUID | None,
) -> None:
    now = datetime.now(UTC)
    cursor = batch.cursor
    if (
        source.provider == CalendarProvider.MICROSOFT
        and outcome.unknown_removals
        and not batch.full_scan
    ):
        # A removed plain occurrence names no series; only a whole read can find which one.
        cursor = None
    row.cursor = cursor
    row.window_start = source.target.window_start
    row.window_end = source.target.window_end
    if scan_id is not None:
        row.scan_id = scan_id
    if batch.full_scan:
        row.skipped_count = len(batch.skipped)
    else:
        row.skipped_count = row.skipped_count + len(batch.skipped)
    for item in batch.skipped:
        logger.info(
            "Provider event skipped",
            connected_calendar_id=str(row.id),
            provider_event_id=item.provider_event_id[:200],
            reason=item.reason.value,
        )
    if outcome.changed:
        row.search_stale = True
    row.last_attempt_at = now
    row.last_success_at = now
    row.consecutive_failures = 0
    row.last_error_code = None
    row.last_error_status = None
    row.next_sync_at = next_after_success(now, row.id, is_system=row.is_system)


async def _record_totals(
    session: AsyncSession, row: ConnectedCalendar, connection_id: UUID, outcome: SyncOutcome
) -> None:
    if outcome.changed or row.event_count == 0:
        row.event_count = (
            await session.scalar(
                select(func.count())
                .select_from(CalendarEventLink)
                .where(
                    CalendarEventLink.connected_calendar_id == row.id,
                    CalendarEventLink.is_owner_link.is_(True),
                )
            )
        ) or 0
    await session.execute(
        update(CalendarConnection)
        .where(CalendarConnection.id == connection_id)
        .values(last_synced_at=row.last_success_at)
    )


async def _project(
    session: AsyncSession, search_indexer: SearchIndexer, source: _Source, outcome: SyncOutcome
) -> None:
    try:
        if outcome.removed_ids:
            await remove_event_documents(search_indexer, source.organization_id, outcome.removed_ids)
        written = list(dict.fromkeys(outcome.written_ids))
        if written:
            await FeedEventProjection(session, search_indexer).index_events(written)
            # Events with member guests need their grants in the document, one by one.
            for start in range(0, len(written), _PROJECTION_CHUNK):
                chunk = written[start : start + _PROJECTION_CHUNK]
                shared = (
                    await session.execute(
                        select(CalendarEvent).where(
                            CalendarEvent.id.in_(chunk),
                            CalendarEvent.is_deleted.is_(False),
                            select(EventAttendee.event_id)
                            .where(EventAttendee.event_id == CalendarEvent.id)
                            .exists(),
                        )
                    )
                ).scalars()
                for event in list(shared):
                    await refresh_event_search_projection(session, event, search_indexer)
    except Exception:
        logger.opt(exception=True).warning(
            "Connected calendar search projection deferred to the next round",
            connected_calendar_id=str(source.connected_calendar_id),
        )
        await session.rollback()
        return
    await session.execute(
        update(ConnectedCalendar)
        .where(ConnectedCalendar.id == source.connected_calendar_id)
        .values(search_stale=False)
    )
    await session.commit()


async def publish_calendar_changed(calendar_id: UUID, organization_id: UUID) -> None:
    try:
        await publish_content_changed(ContentType.CALENDAR, calendar_id, organization_id)
    except Exception:
        logger.opt(exception=True).warning("Connected calendar change signal failed")


def _failure_of(exc: Exception) -> ProviderError:
    if isinstance(exc, ProviderError):
        return exc
    return ProviderError(SyncFailure.UNREACHABLE, reason=getattr(exc, "reason", None))


async def _record_failure(
    session: AsyncSession, source: _Source, error: ProviderError
) -> SyncReport:
    row = await session.scalar(
        select(ConnectedCalendar)
        .where(ConnectedCalendar.id == source.connected_calendar_id)
        .with_for_update()
    )
    if row is None:
        await session.rollback()
        return SyncReport(SyncStatus.SKIPPED)
    now = datetime.now(UTC)
    failures = row.consecutive_failures + 1
    row.consecutive_failures = failures
    row.last_attempt_at = now
    row.last_error_code = error.failure
    row.last_error_status = error.status
    row.next_sync_at = next_after_failure(now, failures, retry_after=error.retry_after)
    await session.commit()
    logger.info(
        "Connected calendar sync failed",
        connected_calendar_id=str(source.connected_calendar_id),
        provider=source.provider.value,
        failure=error.failure.value,
        status=error.status,
        consecutive_failures=failures,
    )
    if failures == 1:
        await publish_calendar_changed(source.calendar_id, source.organization_id)
    return SyncReport(SyncStatus.FAILED, failure=error.failure)
