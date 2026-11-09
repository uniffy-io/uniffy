"""Subscribe to a feed, change it, or ask for a refresh; unsubscribing is deleting the calendar."""

import hashlib
from collections.abc import Collection
from datetime import UTC, datetime
from urllib.parse import urlsplit
from uuid import UUID

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.membership import get_active_membership
from uniffy.core.crypto.org_cipher import OrgCipher
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.jobs import JobEnqueueOutcome, enqueue_job_reconnecting, run_job_and_wait
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.subscription import (
    DEFAULT_REFRESH_INTERVAL_MINUTES,
    CalendarSubscription,
)
from uniffy.core.rate_limit import check_rate_limit
from uniffy.core.search import SearchIndexer
from uniffy.core.types import CalendarType, ContentType
from uniffy.domains.scheduling.calendar.calendars.operations import CalendarOperations
from uniffy.domains.scheduling.calendar.calendars.subscribed import stage_subscribed_calendar
from uniffy.domains.scheduling.calendar.jobs.contracts import REFRESH_CALENDAR_SUBSCRIPTION
from uniffy.domains.scheduling.calendar.jobs.subscriptions import CHECK_JOB_TIMEOUT_SECONDS
from uniffy.domains.scheduling.calendar.policy import require_can_subscribe
from uniffy.domains.scheduling.calendar.subscriptions.refresh import publish_subscription_changed
from uniffy.domains.scheduling.calendar.subscriptions.state import REFRESH_INTERVALS_MINUTES
from uniffy.domains.scheduling.calendar.subscriptions.verify import verify_address
from uniffy.infrastructure.outbound import OutboundFetchError, normalize_public_url

logger = logger.bind(component="scheduling.calendar.subscriptions.operations")

MAX_SUBSCRIPTIONS_PER_MEMBER = 25
# Retry waits for its refresh, so one member can at most keep one fetch running at a time.
_REFRESH_LIMIT = 5
_REFRESH_RATE_WINDOW_SECONDS = 60
# A new address is fetched at once; this keeps a member from turning that into a prober.
_NEW_ADDRESS_LIMIT = 10
_NEW_ADDRESS_WINDOW_SECONDS = 3600


async def _limit_new_addresses(user_id: UUID, organization_id: UUID) -> None:
    await check_rate_limit(
        key=f"rl:calendar_subscription_address:{organization_id}:{user_id}",
        limit=_NEW_ADDRESS_LIMIT,
        window_seconds=_NEW_ADDRESS_WINDOW_SECONDS,
        resource="calendar subscription",
    )


def url_digest(normalized_url: str) -> str:
    return hashlib.sha256(normalized_url.encode("utf-8")).hexdigest()


def _normalized(raw: str) -> str:
    try:
        return normalize_public_url(raw)
    except OutboundFetchError as exc:
        raise ValidationError(
            "url", "Enter a calendar address that starts with https://, http:// or webcal://."
        ) from exc


def _interval(minutes: int | None) -> int:
    if not minutes:
        return DEFAULT_REFRESH_INTERVAL_MINUTES
    if minutes not in REFRESH_INTERVALS_MINUTES:
        raise ValidationError("refresh_interval_minutes", "Choose one of the offered intervals.")
    return minutes


class CalendarSubscriptionOperations:
    def __init__(self, session: AsyncSession, search_indexer: SearchIndexer) -> None:
        self.session = session
        self.search_indexer = search_indexer

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        *,
        url: str,
        name: str,
        color: str,
        refresh_interval_minutes: int | None,
        counts_as_busy: bool,
    ) -> Calendar:
        if await get_active_membership(self.session, user_id, organization_id) is None:
            raise PermissionDeniedError("create", ContentType.CALENDAR.value)
        await require_can_subscribe(self.session, organization_id)
        normalized = _normalized(url)
        interval = _interval(refresh_interval_minutes)
        digest = url_digest(normalized)
        host = urlsplit(normalized).hostname or ""

        held = await self.session.scalar(
            select(func.count())
            .select_from(CalendarSubscription)
            .where(
                CalendarSubscription.organization_id == organization_id,
                CalendarSubscription.owner_id == user_id,
            )
        )
        if (held or 0) >= MAX_SUBSCRIPTIONS_PER_MEMBER:
            raise ValidationError(
                "url", f"You can follow at most {MAX_SUBSCRIPTIONS_PER_MEMBER} calendars."
            )
        if await self._find_by_digest(user_id, organization_id, digest) is not None:
            raise ValidationError("url", "You already subscribe to this calendar.")
        await _limit_new_addresses(user_id, organization_id)
        await verify_address(self.session, organization_id, normalized)

        calendars = CalendarOperations(self.session, self.search_indexer)
        try:
            calendar = await stage_subscribed_calendar(
                self.session, user_id, organization_id, name.strip() or host, color
            )
            subscription = CalendarSubscription(
                organization_id=organization_id,
                owner_id=user_id,
                calendar_id=calendar.id,
                url_encrypted=await OrgCipher(self.session).encrypt(organization_id, normalized),
                url_digest=digest,
                url_host=host[:255],
                refresh_interval_minutes=interval,
                counts_as_busy=counts_as_busy,
                next_refresh_at=datetime.now(UTC),
            )
            self.session.add(subscription)
            await self.session.flush()
            await write_audit_event(
                self.session,
                organization_id=organization_id,
                actor_user_id=user_id,
                action=Action.CALENDAR_SUBSCRIPTION_CREATED,
                resource_type=AuditResourceType.CALENDAR,
                resource_id=calendar.id,
                # The host only: the path of a private feed link is its secret.
                details={
                    "host": host,
                    "refresh_interval_minutes": interval,
                    "counts_as_busy": counts_as_busy,
                },
            )
            await self.session.commit()
        except IntegrityError as exc:
            # A concurrent subscribe to the same address won the unique index.
            await self.session.rollback()
            raise ValidationError("url", "You already subscribe to this calendar.") from exc
        except Exception:
            await self.session.rollback()
            raise
        await self.session.refresh(calendar)
        await calendars.finish_subscribed_calendar(calendar)
        await self._after_change(subscription)
        return calendar

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        calendar_id: UUID,
        *,
        url: str | None,
        refresh_interval_minutes: int | None,
        counts_as_busy: bool | None,
    ) -> CalendarSubscription:
        normalized = _normalized(url) if url is not None else None
        digest = url_digest(normalized) if normalized is not None else None
        current = await self.get_owned(user_id, organization_id, calendar_id)
        replacing = digest is not None and digest != current.url_digest
        if replacing:
            await require_can_subscribe(self.session, organization_id)
            if await self._find_by_digest(user_id, organization_id, digest) is not None:
                raise ValidationError("url", "You already subscribe to this calendar.")
            await _limit_new_addresses(user_id, organization_id)
            # Checked before the row is locked: the read can take as long as the host does.
            await verify_address(self.session, organization_id, normalized)

        subscription = await self.get_owned(user_id, organization_id, calendar_id, lock=True)
        changed: dict[str, object] = {}
        refresh_now = False
        if replacing and normalized is not None and digest is not None:
            # Only an address this request checked is ever stored.
            if digest != subscription.url_digest:
                subscription.url_encrypted = await OrgCipher(self.session).encrypt(
                    organization_id, normalized
                )
                subscription.url_digest = digest
                subscription.url_host = (urlsplit(normalized).hostname or "")[:255]
                # A new address is a new source: nothing learned from the old one applies.
                subscription.etag = None
                subscription.last_modified = None
                subscription.content_digest = None
                subscription.consecutive_failures = 0
                subscription.failure_notified_at = None
                subscription.last_error_code = None
                subscription.last_error_status = None
                subscription.last_success_at = None
                subscription.event_count = 0
                subscription.skipped_count = 0
                changed["host"] = subscription.url_host
                refresh_now = True
        if refresh_interval_minutes is not None:
            interval = _interval(refresh_interval_minutes)
            if interval != subscription.refresh_interval_minutes:
                subscription.refresh_interval_minutes = interval
                changed["refresh_interval_minutes"] = interval
        if counts_as_busy is not None and counts_as_busy != subscription.counts_as_busy:
            subscription.counts_as_busy = counts_as_busy
            changed["counts_as_busy"] = counts_as_busy
        if not changed:
            return subscription
        if refresh_now:
            subscription.next_refresh_at = datetime.now(UTC)
        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.CALENDAR_SUBSCRIPTION_UPDATED,
            resource_type=AuditResourceType.CALENDAR,
            resource_id=calendar_id,
            details=changed,
        )
        await self.session.commit()
        await self.session.refresh(subscription)
        if refresh_now:
            await self._after_change(subscription)
        else:
            await publish_subscription_changed(subscription)
        return subscription

    async def refresh_now(
        self, user_id: UUID, organization_id: UUID, calendar_id: UUID
    ) -> CalendarSubscription:
        subscription = await self.get_owned(user_id, organization_id, calendar_id, lock=True)
        await require_can_subscribe(self.session, organization_id)
        await check_rate_limit(
            key=f"rl:calendar_subscription_refresh:{organization_id}:{calendar_id}",
            limit=_REFRESH_LIMIT,
            window_seconds=_REFRESH_RATE_WINDOW_SECONDS,
            resource="calendar refresh",
        )
        subscription.next_refresh_at = datetime.now(UTC)
        await self.session.commit()
        subscription_id = subscription.id
        try:
            # The caller sees the outcome, not "queued"; the refresh itself records it.
            await run_job_and_wait(
                REFRESH_CALENDAR_SUBSCRIPTION,
                str(subscription_id),
                timeout=CHECK_JOB_TIMEOUT_SECONDS,
            )
        except Exception:
            # Still due, so the every-minute dispatcher runs it; the row reports back when done.
            logger.warning(
                "Calendar subscription refresh did not answer in time",
                subscription_id=str(subscription_id),
            )
        return await self.get_owned(user_id, organization_id, calendar_id)

    async def get_owned(
        self, user_id: UUID, organization_id: UUID, calendar_id: UUID, *, lock: bool = False
    ) -> CalendarSubscription:
        """The subscription behind a calendar, for its owner; anyone else sees nothing."""
        if await get_active_membership(self.session, user_id, organization_id) is None:
            raise NotFoundError("Calendar", calendar_id)
        query = (
            select(CalendarSubscription)
            .join(Calendar, Calendar.id == CalendarSubscription.calendar_id)
            .where(
                CalendarSubscription.calendar_id == calendar_id,
                CalendarSubscription.organization_id == organization_id,
                CalendarSubscription.owner_id == user_id,
                Calendar.owner_id == user_id,
                Calendar.calendar_type == CalendarType.SUBSCRIBED,
                Calendar.is_deleted.is_(False),
            )
        )
        if lock:
            query = query.with_for_update(of=CalendarSubscription)
        subscription = await self.session.scalar(query)
        if subscription is None:
            raise NotFoundError("Calendar", calendar_id)
        return subscription

    async def _find_by_digest(
        self, user_id: UUID, organization_id: UUID, digest: str
    ) -> CalendarSubscription | None:
        return await self.session.scalar(
            select(CalendarSubscription).where(
                CalendarSubscription.organization_id == organization_id,
                CalendarSubscription.owner_id == user_id,
                CalendarSubscription.url_digest == digest,
            )
        )

    async def _after_change(self, subscription: CalendarSubscription) -> None:
        # The every-minute dispatcher finds the row due anyway; this only saves the wait.
        try:
            result = await enqueue_job_reconnecting(
                REFRESH_CALENDAR_SUBSCRIPTION, str(subscription.id)
            )
            if result.outcome == JobEnqueueOutcome.UNAVAILABLE:
                logger.warning(
                    "Calendar subscription refresh not queued; the schedule will pick it up",
                    subscription_id=str(subscription.id),
                )
        except Exception:
            logger.opt(exception=True).warning(
                "Calendar subscription refresh not queued; the schedule will pick it up",
                subscription_id=str(subscription.id),
            )
        await publish_subscription_changed(subscription)


async def owned_subscriptions(
    session: AsyncSession, user_id: UUID, organization_id: UUID, calendar_ids: Collection[UUID]
) -> dict[UUID, CalendarSubscription]:
    """The caller's own subscriptions among these calendars, keyed by calendar."""
    if not calendar_ids:
        return {}
    rows = await session.execute(
        select(CalendarSubscription).where(
            CalendarSubscription.calendar_id.in_(calendar_ids),
            CalendarSubscription.organization_id == organization_id,
            CalendarSubscription.owner_id == user_id,
        )
    )
    return {row.calendar_id: row for row in rows.scalars()}
