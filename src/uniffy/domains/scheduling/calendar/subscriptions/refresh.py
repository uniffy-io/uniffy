"""One refresh of one feed: fetch, skip what has not changed, mirror the rest, record the outcome."""

import asyncio
import hashlib
import traceback
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from loguru import logger
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.crypto.org_cipher import OrgCipher
from uniffy.core.events import NotificationEvent, emit_notification
from uniffy.core.events.bus import stage_notification_events
from uniffy.core.events.realtime import publish_content_changed
from uniffy.core.jobs import enqueue_job_reconnecting
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.subscription import CalendarSubscription, SubscriptionFailure
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.search.indexer import SearchIndexer, build_content_urn
from uniffy.core.types import CalendarType, ContentType, NotificationType
from uniffy.domains.notifications.jobs.contracts import (
    DELIVER_NOTIFICATION_OUTBOX,
    notification_outbox_job_id,
)
from uniffy.domains.scheduling.calendar.calendars.search import remove_event_documents
from uniffy.domains.scheduling.calendar.ical.parse import (
    FEED_LIMITS,
    DocumentRefused,
    ImportRejection,
    ParsedCalendar,
    parse_calendar,
)
from uniffy.domains.scheduling.calendar.ical.sync import SyncOutcome, stage_feed_sync
from uniffy.domains.scheduling.calendar.policy import resolve_calendar_policy
from uniffy.domains.scheduling.calendar.search import FeedEventProjection
from uniffy.domains.scheduling.calendar.subscriptions.state import (
    BROKEN_AFTER_FAILURES,
    PAUSED_RECHECK,
    next_after_failure,
    next_after_success,
)
from uniffy.infrastructure.outbound import OutboundFailure, OutboundFetchError, fetch_public

logger = logger.bind(component="scheduling.calendar.subscriptions.refresh")

FETCH_DEADLINE_SECONDS = 30.0
_FETCH_CALLER = "calendar_subscription"
_CALENDAR_PREFIX = b"BEGIN:VCALENDAR"
_BOM = b"\xef\xbb\xbf"
_HEAD_BYTES = 4096

_OUTBOUND_FAILURES: dict[OutboundFailure, SubscriptionFailure] = {
    OutboundFailure.INVALID_URL: SubscriptionFailure.INVALID_URL,
    OutboundFailure.UNRESOLVABLE: SubscriptionFailure.UNRESOLVABLE,
    OutboundFailure.BLOCKED_ADDRESS: SubscriptionFailure.BLOCKED_ADDRESS,
    OutboundFailure.UNREACHABLE: SubscriptionFailure.UNREACHABLE,
    OutboundFailure.TIMEOUT: SubscriptionFailure.TIMEOUT,
    OutboundFailure.HTTP_STATUS: SubscriptionFailure.HTTP_STATUS,
    OutboundFailure.TOO_LARGE: SubscriptionFailure.TOO_LARGE,
    OutboundFailure.REDIRECT_REFUSED: SubscriptionFailure.REDIRECT_REFUSED,
    OutboundFailure.TOO_MANY_REDIRECTS: SubscriptionFailure.TOO_MANY_REDIRECTS,
}

_REJECTION_FAILURES: dict[ImportRejection, SubscriptionFailure] = {
    ImportRejection.PAYLOAD_TOO_LARGE: SubscriptionFailure.TOO_LARGE,
    ImportRejection.TOO_MANY_EVENTS: SubscriptionFailure.TOO_MANY_EVENTS,
}


class RefreshStatus(StrEnum):
    SYNCED = "synced"
    UNCHANGED = "unchanged"
    FAILED = "failed"
    PAUSED = "paused"
    SKIPPED = "skipped"


@dataclass(frozen=True)
class RefreshReport:
    status: RefreshStatus
    created: int = 0
    updated: int = 0
    deleted: int = 0
    failure: SubscriptionFailure | None = None

    def as_dict(self) -> dict[str, object]:
        report: dict[str, object] = {"status": self.status.value}
        if self.status == RefreshStatus.SYNCED:
            report.update(created=self.created, updated=self.updated, deleted=self.deleted)
        if self.failure is not None:
            report["failure"] = self.failure.value
        return report


class _Refused(Exception):
    def __init__(self, failure: SubscriptionFailure, status: int | None = None) -> None:
        self.failure = failure
        self.status = status
        super().__init__(failure.value)


@dataclass(frozen=True)
class _Source:
    """What a refresh needs from the row, read before the network so no lock spans the fetch."""

    subscription_id: UUID
    organization_id: UUID
    calendar_id: UUID
    calendar_name: str
    url: str = field(repr=False)
    url_digest: str
    etag: str | None
    last_modified: str | None
    content_digest: str | None


@dataclass(frozen=True)
class _Fetched:
    body_digest: str | None
    etag: str | None
    last_modified: str | None
    parsed: ParsedCalendar | None


async def run_refresh(
    session: AsyncSession, subscription_id: UUID, search_indexer: SearchIndexer
) -> RefreshReport:
    loaded = await _load(session, subscription_id)
    if loaded is None:
        return RefreshReport(RefreshStatus.SKIPPED)
    subscription, calendar_name = loaded

    policy = await resolve_calendar_policy(session, subscription.organization_id)
    if not policy.allow_external_subscriptions:
        # Paused, not failing: turning the policy back on resumes without a backlog of errors.
        await session.refresh(subscription, with_for_update=True)
        subscription.last_error_code = SubscriptionFailure.POLICY_DISABLED
        subscription.last_error_status = None
        subscription.next_refresh_at = datetime.now(UTC) + PAUSED_RECHECK
        await session.commit()
        return RefreshReport(RefreshStatus.PAUSED)

    source = _Source(
        subscription_id=subscription.id,
        organization_id=subscription.organization_id,
        calendar_id=subscription.calendar_id,
        calendar_name=calendar_name,
        url=await OrgCipher(session).decrypt(
            subscription.organization_id, subscription.url_encrypted
        ),
        url_digest=subscription.url_digest,
        etag=subscription.etag,
        last_modified=subscription.last_modified,
        content_digest=subscription.content_digest,
    )
    await session.rollback()

    try:
        fetched = await _fetch(
            source.url,
            etag=source.etag,
            last_modified=source.last_modified,
            content_digest=source.content_digest,
        )
    except _Refused as refused:
        return await _record_failure(session, source, refused)

    subscription = await _lock_unchanged(session, source)
    if subscription is None:
        # Deleted, or pointed at a new address mid-fetch; that change queued its own refresh.
        return RefreshReport(RefreshStatus.SKIPPED)
    was_healthy = subscription.consecutive_failures == 0 and subscription.last_success_at
    search_behind = subscription.search_stale
    try:
        outcome = await _stage_success(session, subscription, fetched)
        await session.commit()
    except Exception:
        # Anything the feed made us store and the database refused counts as a failure,
        # so the row backs off and its owner hears about it instead of looping silently.
        await session.rollback()
        logger.warning(
            "Calendar subscription could not be stored",
            subscription_id=str(source.subscription_id),
            traceback=traceback.format_exc(),
        )
        return await _record_failure(session, source, _Refused(SubscriptionFailure.UNPROCESSABLE))

    if subscription.search_stale:
        await _project(session, search_indexer, subscription, outcome, rewrite_all=search_behind)
    if outcome is None or not outcome.changed:
        if not was_healthy:
            await publish_subscription_changed(subscription)
        return RefreshReport(RefreshStatus.UNCHANGED)
    await publish_subscription_changed(subscription)
    return RefreshReport(
        RefreshStatus.SYNCED,
        created=outcome.created,
        updated=outcome.updated,
        deleted=outcome.deleted,
    )


async def _stage_success(
    session: AsyncSession, subscription: CalendarSubscription, fetched: _Fetched
) -> SyncOutcome | None:
    outcome = None
    if fetched.parsed is not None:
        outcome = await stage_feed_sync(
            session,
            organization_id=subscription.organization_id,
            owner_id=subscription.owner_id,
            calendar_id=subscription.calendar_id,
            parsed=fetched.parsed,
        )
        subscription.content_digest = fetched.body_digest
        subscription.event_count = len(fetched.parsed.events)
        subscription.skipped_count = len(fetched.parsed.skipped)
        if outcome.changed:
            subscription.search_stale = True
    if fetched.body_digest is not None or fetched.etag or fetched.last_modified:
        subscription.etag = fetched.etag[:500] if fetched.etag else None
        subscription.last_modified = fetched.last_modified[:100] if fetched.last_modified else None

    now = datetime.now(UTC)
    subscription.last_attempt_at = now
    subscription.last_success_at = now
    subscription.consecutive_failures = 0
    subscription.failure_notified_at = None
    subscription.last_error_code = None
    subscription.last_error_status = None
    subscription.next_refresh_at = next_after_success(
        now, subscription.refresh_interval_minutes, subscription.id
    )
    return outcome


async def _project(
    session: AsyncSession,
    search_indexer: SearchIndexer,
    subscription: CalendarSubscription,
    outcome: SyncOutcome | None,
    *,
    rewrite_all: bool,
) -> None:
    """Bring search in line with the committed rows, then clear the flag that says it is not."""
    # A flag left by an earlier refresh means some writes may be missing: rewrite it all.
    subscription_id = subscription.id
    organization_id = subscription.organization_id
    calendar_id = subscription.calendar_id
    projection = FeedEventProjection(session, search_indexer)
    try:
        if outcome is not None and outcome.removed_ids:
            await remove_event_documents(search_indexer, organization_id, outcome.removed_ids)
        if rewrite_all or outcome is None:
            await projection.index_calendar(calendar_id)
        else:
            await projection.index_events(outcome.written_ids)
            await projection.publish_changed(outcome.rewritten_ids)
    except Exception:
        logger.opt(exception=True).warning(
            "Subscribed calendar search projection deferred to the next refresh",
            subscription_id=str(subscription_id),
        )
        return
    await session.execute(
        update(CalendarSubscription)
        .where(CalendarSubscription.id == subscription_id)
        .values(search_stale=False)
    )
    await session.commit()


async def _load(
    session: AsyncSession, subscription_id: UUID
) -> tuple[CalendarSubscription, str] | None:
    """The subscription, only while its calendar, owner and organization are all live."""
    row = (
        await session.execute(
            select(CalendarSubscription, Calendar.name)
            .join(Calendar, Calendar.id == CalendarSubscription.calendar_id)
            .join(
                OrganizationMember,
                (OrganizationMember.organization_id == CalendarSubscription.organization_id)
                & (OrganizationMember.user_id == CalendarSubscription.owner_id),
            )
            .join(User, User.id == CalendarSubscription.owner_id)
            .join(Organization, Organization.id == CalendarSubscription.organization_id)
            .where(
                CalendarSubscription.id == subscription_id,
                Calendar.is_deleted.is_(False),
                Calendar.calendar_type == CalendarType.SUBSCRIBED,
                OrganizationMember.is_active.is_(True),
                User.is_active.is_(True),
                Organization.deleted_at.is_(None),
                Organization.is_suspended.is_(False),
            )
        )
    ).one_or_none()
    if row is None:
        return None
    return row[0], row[1]


async def _lock_unchanged(session: AsyncSession, source: _Source) -> CalendarSubscription | None:
    # Calendar first, as unsubscribing does: it holds the calendar FOR UPDATE and then
    # deletes this row, while our event inserts would key-share the calendar after it.
    await session.execute(
        select(Calendar.id)
        .where(Calendar.id == source.calendar_id)
        .with_for_update(read=True, key_share=True)
    )
    return await session.scalar(
        select(CalendarSubscription)
        .where(
            CalendarSubscription.id == source.subscription_id,
            CalendarSubscription.url_digest == source.url_digest,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )


async def _fetch(
    url: str,
    *,
    etag: str | None = None,
    last_modified: str | None = None,
    content_digest: str | None = None,
) -> _Fetched:
    """The parsed feed, or no ``parsed`` when the source has not changed since the last success."""
    headers: dict[str, str] = {}
    if etag:
        headers["if-none-match"] = etag
    if last_modified:
        headers["if-modified-since"] = last_modified
    try:
        fetched = await fetch_public(
            url,
            caller=_FETCH_CALLER,
            max_bytes=FEED_LIMITS.max_bytes,
            deadline_seconds=FETCH_DEADLINE_SECONDS,
            headers=headers,
        )
    except OutboundFetchError as exc:
        raise _Refused(_OUTBOUND_FAILURES[exc.failure], exc.status) from exc

    if fetched.body is None:
        return _Fetched(None, etag, last_modified, None)
    digest = hashlib.sha256(fetched.body).hexdigest()
    if digest == content_digest:
        return _Fetched(digest, fetched.etag, fetched.last_modified, None)
    # Only the head decides; stripping and upper-casing the whole body would copy it twice.
    head = fetched.body[:_HEAD_BYTES].lstrip(_BOM).lstrip().upper()
    if not head.startswith(_CALENDAR_PREFIX):
        raise _Refused(SubscriptionFailure.NOT_A_CALENDAR)
    return _Fetched(digest, fetched.etag, fetched.last_modified, await _parse(fetched.body))


@dataclass(frozen=True)
class FeedCheck:
    failure: SubscriptionFailure | None
    status: int | None = None
    event_count: int = 0


async def check_feed(url: str) -> FeedCheck:
    """Read an address the way a refresh would, without storing anything."""
    try:
        fetched = await _fetch(url)
    except _Refused as refused:
        return FeedCheck(refused.failure, refused.status)
    events = len(fetched.parsed.events) if fetched.parsed is not None else 0
    return FeedCheck(None, event_count=events)


async def _parse(body: bytes) -> ParsedCalendar:
    # Thousands of entries are seconds of CPU; on the loop they would stall every
    # other egress job sharing this worker.
    try:
        return await asyncio.to_thread(parse_calendar, body, FEED_LIMITS)
    except DocumentRefused as refused:
        failure = _REJECTION_FAILURES.get(refused.rejection, SubscriptionFailure.NOT_A_CALENDAR)
        raise _Refused(failure) from refused


async def _record_failure(
    session: AsyncSession, source: _Source, refused: _Refused
) -> RefreshReport:
    subscription = await _lock_unchanged(session, source)
    if subscription is None:
        return RefreshReport(RefreshStatus.SKIPPED)
    now = datetime.now(UTC)
    failures = subscription.consecutive_failures + 1
    subscription.consecutive_failures = failures
    subscription.last_attempt_at = now
    subscription.last_error_code = refused.failure
    subscription.last_error_status = refused.status
    subscription.next_refresh_at = next_after_failure(
        now, subscription.refresh_interval_minutes, failures
    )
    # Exactly one notice per break: set with the failure that crosses the line,
    # cleared only by a success.
    notify = failures >= BROKEN_AFTER_FAILURES and subscription.failure_notified_at is None
    staged: list[UUID] = []
    if notify:
        subscription.failure_notified_at = now
        # Staged in this transaction: the notice and the flag that it was sent commit together,
        # and the core fleet's outbox sweep delivers it even if the wakeup below is lost.
        with stage_notification_events(session) as staged:
            await _notify_broken(subscription, source.calendar_name)
    await session.commit()
    logger.info(
        "Calendar subscription refresh failed",
        subscription_id=str(source.subscription_id),
        failure=refused.failure.value,
        status=refused.status,
        consecutive_failures=failures,
    )
    await _wake_outbox(staged)
    await publish_subscription_changed(subscription)
    return RefreshReport(RefreshStatus.FAILED, failure=refused.failure)


async def _notify_broken(subscription: CalendarSubscription, calendar_name: str) -> None:
    await emit_notification(
        NotificationEvent(
            notification_type=NotificationType.CALENDAR_SUBSCRIPTION_FAILED,
            organization_id=subscription.organization_id,
            actor_id=None,
            title=f"{calendar_name} stopped updating",
            body=f"Uniffy could not refresh the calendar from {subscription.url_host}.",
            source_urn=build_content_urn(ContentType.CALENDAR, subscription.calendar_id),
            target_user_ids=[subscription.owner_id],
        )
    )


async def _wake_outbox(event_ids: list[UUID]) -> None:
    for event_id in event_ids:
        try:
            await enqueue_job_reconnecting(
                DELIVER_NOTIFICATION_OUTBOX,
                str(event_id),
                _job_id=notification_outbox_job_id(event_id),
            )
        except Exception:
            logger.warning(
                "Notification wakeup deferred to the outbox sweep", event_id=str(event_id)
            )


async def publish_subscription_changed(subscription: CalendarSubscription) -> None:
    try:
        await publish_content_changed(
            ContentType.CALENDAR, subscription.calendar_id, subscription.organization_id
        )
    except Exception:
        logger.opt(exception=True).warning("Subscribed calendar refresh signal failed")
