"""The pending-mail table: staging inside a mutation, claiming inside the job."""

from collections.abc import Iterable, Sequence
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.calendar.mail_delivery import (
    CalendarMailDelivery,
    CalendarMailKind,
    CalendarMailStatus,
)
from uniffy.core.types import generate_id

# Edits landing inside this window produce one message describing the final
# state, rather than one message per keystroke-sized change.
COALESCE_WINDOW = timedelta(seconds=60)

# A send is retried by the schedule rather than in-process; past this the row
# is terminal and stops being claimed.
MAX_ATTEMPTS = 5

CLAIM_LIMIT = 200


async def stage_event_mail(
    session: AsyncSession,
    *,
    organization_id: UUID,
    event_id: UUID,
    recipient_ids: Iterable[UUID],
    kind: CalendarMailKind,
    actor_user_id: UUID | None = None,
    occurrence_date: date | None = None,
    now: datetime | None = None,
) -> int:
    """Add pending rows to the caller's transaction without committing.

    A recipient who already has an unsent message of this kind for this event
    keeps the row they have: the job reads the event at send time, so the
    message they eventually receive describes the final state either way.
    """
    recipients = list(dict.fromkeys(recipient_ids))
    if not recipients:
        return 0

    moment = now or datetime.now(UTC)
    due = moment + COALESCE_WINDOW
    await session.execute(
        pg_insert(CalendarMailDelivery)
        .values([
            {
                "id": generate_id(),
                "organization_id": organization_id,
                "event_id": event_id,
                "recipient_user_id": recipient_id,
                "actor_user_id": actor_user_id,
                "kind": kind,
                "status": CalendarMailStatus.PENDING,
                "occurrence_date": occurrence_date,
                "scheduled_for": due,
                "attempts": 0,
                "created_at": moment,
                "updated_at": moment,
            }
            for recipient_id in recipients
        ])
        .on_conflict_do_nothing()
    )
    return len(recipients)


async def claim_due_deliveries(
    session: AsyncSession,
    *,
    now: datetime,
    limit: int = CLAIM_LIMIT,
) -> list[CalendarMailDelivery]:
    """Take ownership of due rows, skipping any another worker already holds."""
    rows = (
        (
            await session.execute(
                select(CalendarMailDelivery)
                .where(
                    CalendarMailDelivery.status == CalendarMailStatus.PENDING,
                    CalendarMailDelivery.scheduled_for <= now,
                    CalendarMailDelivery.attempts < MAX_ATTEMPTS,
                )
                .order_by(CalendarMailDelivery.scheduled_for)
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
        )
        .scalars()
        .all()
    )
    for row in rows:
        row.attempts += 1
        row.updated_at = now
    return list(rows)


async def mark_sent(
    session: AsyncSession, deliveries: Sequence[CalendarMailDelivery], now: datetime
) -> None:
    _settle(deliveries, CalendarMailStatus.SENT, now)


async def mark_failed(
    session: AsyncSession,
    deliveries: Sequence[CalendarMailDelivery],
    now: datetime,
    error: str,
) -> None:
    """A row under the attempt ceiling stays PENDING for the next schedule."""
    for delivery in deliveries:
        delivery.last_error = error[:1000]
        delivery.updated_at = now
        if delivery.attempts >= MAX_ATTEMPTS:
            delivery.status = CalendarMailStatus.FAILED


def _settle(
    deliveries: Sequence[CalendarMailDelivery], status: CalendarMailStatus, now: datetime
) -> None:
    for delivery in deliveries:
        delivery.status = status
        delivery.updated_at = now


async def drop_pending_for_recipients(
    session: AsyncSession, event_id: UUID, recipient_ids: Sequence[UUID], now: datetime
) -> None:
    """An attendee removed before the message goes out should not receive it."""
    if not recipient_ids:
        return
    await session.execute(
        update(CalendarMailDelivery)
        .where(
            CalendarMailDelivery.event_id == event_id,
            CalendarMailDelivery.recipient_user_id.in_(recipient_ids),
            CalendarMailDelivery.status == CalendarMailStatus.PENDING,
        )
        .values(status=CalendarMailStatus.FAILED, updated_at=now, last_error="recipient removed")
    )
