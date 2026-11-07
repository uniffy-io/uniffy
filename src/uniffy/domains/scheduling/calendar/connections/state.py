"""How healthy a connected calendar is, and when it syncs next."""

from datetime import datetime, timedelta
from enum import StrEnum
from typing import Any
from uuid import UUID

from sqlalchemy import Select

from uniffy.core.models.calendar.connection import (
    CalendarConnection,
    ConnectedCalendar,
    ConnectedCalendarState,
    ConnectionStatus,
)
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User

# The third failure in a row marks the calendar broken in the sidebar.
BROKEN_AFTER_FAILURES = 3
POLL_INTERVAL = timedelta(minutes=5)
# Holidays and other generated calendars barely change.
SYSTEM_POLL_INTERVAL = timedelta(hours=24)
DISCOVERY_INTERVAL = timedelta(minutes=30)
MAX_BACKOFF = timedelta(hours=2)
# How soon a calendar paused by its owner or by policy is looked at again.
PAUSED_RECHECK = timedelta(minutes=15)
_BASE_BACKOFF = timedelta(minutes=5)


def owned_by_live_member[T: tuple[Any, ...]](statement: Select[T]) -> Select[T]:
    """Only connections whose owner is still an active member of a live organization."""
    return (
        statement
        .join(
            OrganizationMember,
            (OrganizationMember.organization_id == CalendarConnection.organization_id)
            & (OrganizationMember.user_id == CalendarConnection.owner_id),
        )
        .join(User, User.id == CalendarConnection.owner_id)
        .join(Organization, Organization.id == CalendarConnection.organization_id)
        .where(
            CalendarConnection.status == ConnectionStatus.ACTIVE,
            OrganizationMember.is_active.is_(True),
            User.is_active.is_(True),
            Organization.deleted_at.is_(None),
            Organization.is_suspended.is_(False),
        )
    )


class CalendarHealth(StrEnum):
    PENDING = "PENDING"
    HEALTHY = "HEALTHY"
    FAILING = "FAILING"
    BROKEN = "BROKEN"
    PAUSED = "PAUSED"
    REAUTH_REQUIRED = "REAUTH_REQUIRED"
    DETACHED = "DETACHED"


def health_of(
    row: ConnectedCalendar, connection: CalendarConnection, *, policy_allows: bool
) -> CalendarHealth:
    if (
        row.state != ConnectedCalendarState.ACTIVE
        or connection.status == ConnectionStatus.DISCONNECTED
    ):
        return CalendarHealth.DETACHED
    if connection.status == ConnectionStatus.REAUTH_REQUIRED:
        return CalendarHealth.REAUTH_REQUIRED
    if connection.status == ConnectionStatus.PAUSED or not policy_allows:
        return CalendarHealth.PAUSED
    if row.consecutive_failures >= BROKEN_AFTER_FAILURES:
        return CalendarHealth.BROKEN
    if row.consecutive_failures > 0:
        return CalendarHealth.FAILING
    if row.last_success_at is None:
        return CalendarHealth.PENDING
    return CalendarHealth.HEALTHY


def next_after_success(now: datetime, row_id: UUID, *, is_system: bool) -> datetime:
    interval = SYSTEM_POLL_INTERVAL if is_system else POLL_INTERVAL
    # Up to a tenth of the interval, so calendars connected together drift apart.
    offset = (row_id.int % 1000) / 1000 * interval.total_seconds() / 10
    return now + interval + timedelta(seconds=offset)


def next_after_failure(
    now: datetime, failures: int, *, retry_after: float | None = None
) -> datetime:
    # The exponent stops growing long before the cap, so a long outage cannot overflow it.
    backoff = min(_BASE_BACKOFF * (2 ** min(max(0, failures - 1), 16)), MAX_BACKOFF)
    if retry_after is not None:
        backoff = max(backoff, timedelta(seconds=min(retry_after, MAX_BACKOFF.total_seconds())))
    return now + backoff
