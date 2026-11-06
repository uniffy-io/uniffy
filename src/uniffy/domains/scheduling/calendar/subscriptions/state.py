"""How healthy a subscription is, and when it runs next."""

from datetime import datetime, timedelta
from enum import StrEnum
from uuid import UUID

from uniffy.core.models.calendar.subscription import (
    MIN_REFRESH_INTERVAL_MINUTES,
    CalendarSubscription,
)

# The third failure in a row marks the feed broken and tells its owner, once.
BROKEN_AFTER_FAILURES = 3
MAX_BACKOFF = timedelta(hours=24)
REFRESH_INTERVALS_MINUTES = (MIN_REFRESH_INTERVAL_MINUTES, 30, 60, 180, 360, 720, 1440)
# A paused organization's rows step aside so they never hold the dispatch batch,
# and still resume within minutes once the policy is turned back on.
PAUSED_RECHECK = timedelta(minutes=5)


class SubscriptionState(StrEnum):
    PENDING = "PENDING"
    HEALTHY = "HEALTHY"
    FAILING = "FAILING"
    BROKEN = "BROKEN"
    PAUSED = "PAUSED"


def state_of(row: CalendarSubscription, *, policy_allows: bool) -> SubscriptionState:
    if not policy_allows:
        return SubscriptionState.PAUSED
    if row.consecutive_failures >= BROKEN_AFTER_FAILURES:
        return SubscriptionState.BROKEN
    if row.consecutive_failures > 0:
        return SubscriptionState.FAILING
    if row.last_success_at is None:
        return SubscriptionState.PENDING
    return SubscriptionState.HEALTHY


def next_after_success(now: datetime, interval_minutes: int, subscription_id: UUID) -> datetime:
    # A per-feed offset of up to a tenth of the interval, so feeds added together drift apart.
    offset = (subscription_id.int % 1000) / 1000 * interval_minutes * 6
    return now + timedelta(minutes=interval_minutes, seconds=offset)


def next_after_failure(now: datetime, interval_minutes: int, failures: int) -> datetime:
    backoff = timedelta(minutes=interval_minutes) * (2 ** max(0, failures - 1))
    return now + min(backoff, MAX_BACKOFF)
