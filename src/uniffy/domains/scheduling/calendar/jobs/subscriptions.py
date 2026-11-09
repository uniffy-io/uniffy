"""Lease due feed subscriptions on the core fleet; refresh each one on the egress fleet."""

import traceback
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select, update

from uniffy.core.crypto.org_cipher import OrgCipher
from uniffy.core.jobs import JobEnqueueOutcome, enqueue_job_reconnecting
from uniffy.core.jobs.locks import acquire_owned_job_lock, release_owned_job_lock
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.subscription import CalendarSubscription
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.search import SEARCH_INDEXER_CTX_KEY
from uniffy.domains.scheduling.calendar.jobs.contracts import REFRESH_CALENDAR_SUBSCRIPTION
from uniffy.domains.scheduling.calendar.policy import resolve_calendar_policy
from uniffy.domains.scheduling.calendar.subscriptions.refresh import (
    FETCH_DEADLINE_SECONDS,
    RefreshStatus,
    check_feed,
    run_refresh,
)
from uniffy.domains.scheduling.calendar.subscriptions.state import PAUSED_RECHECK
from uniffy.infrastructure.database import open_session
from uniffy.infrastructure.valkey.ops import get_ops_client

logger = logger.bind(component="scheduling.calendar.jobs.subscriptions")

REFRESH_JOB_TIMEOUT_SECONDS = 120
# The fetch deadline plus the parse of a feed at the size limit.
CHECK_JOB_TIMEOUT_SECONDS = int(FETCH_DEADLINE_SECONDS) + 30
# Only the waiting request reads it.
CHECK_RESULT_SECONDS = 120
_DISPATCH_BATCH = 200
# A leased row comes due again if its refresh never reports back.
_LEASE = timedelta(minutes=10)

_LOCK_TTL_SECONDS = REFRESH_JOB_TIMEOUT_SECONDS + 30
_QUEUED = frozenset({JobEnqueueOutcome.ENQUEUED, JobEnqueueOutcome.DEDUPLICATED})


def _lock_key(subscription_id: UUID) -> str:
    return f"calendar_subscription:{subscription_id}:lock"


async def dispatch_calendar_subscription_refreshes(ctx: dict[str, Any]) -> dict[str, int]:
    now = datetime.now(UTC)
    async with open_session() as session:
        rows = (
            await session.execute(
                select(CalendarSubscription.id, CalendarSubscription.organization_id)
                .join(Calendar, Calendar.id == CalendarSubscription.calendar_id)
                .join(
                    OrganizationMember,
                    (OrganizationMember.organization_id == CalendarSubscription.organization_id)
                    & (OrganizationMember.user_id == CalendarSubscription.owner_id),
                )
                .join(User, User.id == CalendarSubscription.owner_id)
                .join(Organization, Organization.id == CalendarSubscription.organization_id)
                .where(
                    CalendarSubscription.next_refresh_at <= now,
                    Calendar.is_deleted.is_(False),
                    OrganizationMember.is_active.is_(True),
                    User.is_active.is_(True),
                    Organization.deleted_at.is_(None),
                    Organization.is_suspended.is_(False),
                )
                .order_by(CalendarSubscription.next_refresh_at)
                .limit(_DISPATCH_BATCH)
                .with_for_update(of=CalendarSubscription, skip_locked=True)
            )
        ).all()

        allowed: dict[UUID, bool] = {}
        for organization_id in {row.organization_id for row in rows}:
            policy = await resolve_calendar_policy(session, organization_id)
            allowed[organization_id] = policy.allow_external_subscriptions
        leased = [row.id for row in rows if allowed[row.organization_id]]
        paused = [row.id for row in rows if not allowed[row.organization_id]]
        for ids, due in ((leased, now + _LEASE), (paused, now + PAUSED_RECHECK)):
            if ids:
                await session.execute(
                    update(CalendarSubscription)
                    .where(CalendarSubscription.id.in_(ids))
                    .values(next_refresh_at=due)
                )
        await session.commit()

    queued = 0
    for subscription_id in leased:
        # The core fleet holds only its own queue pool; this one opens the egress pool on demand.
        try:
            result = await enqueue_job_reconnecting(
                REFRESH_CALENDAR_SUBSCRIPTION,
                str(subscription_id),
                _job_id=f"calendar-subscription:{subscription_id}:{now.isoformat()}",
            )
        except Exception:
            result = None
            logger.opt(exception=True).warning("Calendar subscription refresh enqueue failed")
        if result is not None and result.outcome in _QUEUED:
            queued += 1
        else:
            # The lease lapses and the next run picks the row up again.
            logger.warning(
                "Calendar subscription refresh not queued",
                subscription_id=str(subscription_id),
            )
    return {"due": len(rows), "queued": queued, "paused": len(rows) - len(leased)}


async def refresh_calendar_subscription(ctx: dict[str, Any], subscription_id: str) -> dict:
    try:
        sid = UUID(subscription_id)
    except ValueError:
        logger.error("refresh_calendar_subscription: invalid id", subscription_id=subscription_id)
        return {"status": RefreshStatus.SKIPPED.value}

    client = get_ops_client()
    token = None
    if client is not None:
        try:
            token = await acquire_owned_job_lock(client, _lock_key(sid), _LOCK_TTL_SECONDS)
        except Exception:
            logger.warning("Calendar subscription lock unavailable", subscription_id=str(sid))
        else:
            if token is None:
                return {"status": RefreshStatus.SKIPPED.value, "reason": "lock_held"}

    try:
        async with open_session() as session:
            report = await run_refresh(session, sid, ctx[SEARCH_INDEXER_CTX_KEY])
        return report.as_dict()
    except Exception as exc:
        # No ARQ retry: hammering a broken host helps nobody, and the lease brings the row back.
        # A plain traceback: the sinks' variable dumps would print the sealed feed address.
        logger.error(
            "Calendar subscription refresh crashed",
            subscription_id=str(sid),
            traceback="".join(traceback.format_exception(exc)),
        )
        return {"status": RefreshStatus.FAILED.value}
    finally:
        if client is not None and token is not None:
            try:
                await release_owned_job_lock(client, _lock_key(sid), token)
            except Exception:
                logger.warning("Calendar subscription lock not released", subscription_id=str(sid))


async def check_calendar_feed(ctx: dict[str, Any], organization_id: str, sealed_url: str) -> dict:
    """The outcome of reading a candidate address; the address travels sealed and never returns."""
    try:
        async with open_session() as session:
            url = await OrgCipher(session).decrypt(UUID(organization_id), sealed_url)
        check = await check_feed(url)
    except Exception as exc:
        logger.error(
            "Calendar feed check crashed",
            organization_id=organization_id,
            traceback="".join(traceback.format_exception(exc)),
        )
        return {"failure": None, "crashed": True}
    return {
        "failure": check.failure.value if check.failure is not None else None,
        "status": check.status,
        "event_count": check.event_count,
    }
