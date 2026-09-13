"""Event mail staged onto the shared email outbox: staging here, sending in the job."""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import func, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.notifications.email_delivery import (
    EmailComposer,
    NotificationEmailDelivery,
    NotificationEmailStatus,
)
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType, NotificationType, generate_id
from uniffy.domains.notifications.delivery.outbox import (
    NotificationEmailTerminalReason,
    claim_email_delivery,
    retry_email_deliveries,
    terminal_email_delivery,
)
from uniffy.domains.scheduling.calendar.mail.withdrawal import EventWithdrawal
from uniffy.domains.settings.defaults import EmailFrequency


class CalendarMailKind(StrEnum):
    INVITATION = "INVITATION"
    CHANGE = "CHANGE"
    CANCELLATION = "CANCELLATION"


# Edits landing inside this window produce one message describing the final
# state, rather than one message per keystroke-sized change.
COALESCE_WINDOW = timedelta(seconds=60)

# Which message wins when several fall in the same window: being told the
# meeting is off outranks its details, and an invitation already states the
# time a change notice would describe.
_PRECEDENCE: dict[CalendarMailKind, int] = {
    CalendarMailKind.CHANGE: 1,
    CalendarMailKind.INVITATION: 2,
    CalendarMailKind.CANCELLATION: 3,
}

# There is no CALENDAR_CHANGED notification type, and a member who wants
# invitations wants the updates to them, so changes follow the invite toggle.
_NOTIFICATION_TYPES: dict[CalendarMailKind, NotificationType] = {
    CalendarMailKind.INVITATION: NotificationType.CALENDAR_INVITE,
    CalendarMailKind.CHANGE: NotificationType.CALENDAR_INVITE,
    CalendarMailKind.CANCELLATION: NotificationType.CALENDAR_CANCELLED,
}

_PENDING_INDEX = text("coalesce_key IS NOT NULL AND status = 'pending'")
_WITHDRAWAL = "withdrawal"


@dataclass(frozen=True)
class EventMailRequest:
    """One staged row, read back as what the job has to send."""

    delivery_id: UUID
    organization_id: UUID
    recipient_id: UUID
    event_id: UUID
    kind: CalendarMailKind
    occurrence_date: date | None
    changes: tuple[str, ...]
    withdrawal: EventWithdrawal | None = None


async def stage_event_mail(
    session: AsyncSession,
    *,
    organization_id: UUID,
    event_id: UUID,
    title: str,
    recipient_ids: Iterable[UUID],
    kind: CalendarMailKind,
    actor_user_id: UUID | None = None,
    occurrence_date: date | None = None,
    changes: Iterable[str] = (),
    withdrawal: EventWithdrawal | None = None,
    now: datetime | None = None,
) -> int:
    """Coalesce pending messages within the caller's transaction."""
    recipients = list(dict.fromkeys(recipient_ids))
    if not recipients:
        return 0

    moment = now or datetime.now(UTC)
    due = moment + COALESCE_WINDOW
    keys = {
        recipient_id: _coalesce_key(event_id, occurrence_date, recipient_id)
        for recipient_id in recipients
    }
    await _lock_event_mail(session, event_id)
    metadata = _metadata(kind, occurrence_date, changes, withdrawal)

    claimed = (
        await session.execute(
            pg_insert(NotificationEmailDelivery)
            .values([
                {
                    # The shared row is keyed by the notification that caused
                    # it; event mail has none, so each row owns an identity.
                    "event_id": generate_id(),
                    "organization_id": organization_id,
                    "user_id": recipient_id,
                    "actor_id": actor_user_id,
                    "notification_type": _NOTIFICATION_TYPES[kind].value,
                    "title": title[:500],
                    "source_urn": build_content_urn(ContentType.CALENDAR_EVENT, event_id),
                    "content_type": ContentType.CALENDAR_EVENT.value,
                    "content_id": event_id,
                    "notification_metadata": metadata,
                    "frequency": EmailFrequency.INSTANT.value,
                    "composer": EmailComposer.CALENDAR.value,
                    "coalesce_key": keys[recipient_id],
                    "status": NotificationEmailStatus.PENDING.value,
                    "scheduled_for": due,
                    "created_at": moment,
                    "updated_at": moment,
                }
                for recipient_id in recipients
            ])
            .on_conflict_do_nothing(
                index_elements=["coalesce_key"],
                index_where=_PENDING_INDEX,
            )
            .returning(NotificationEmailDelivery.coalesce_key)
        )
    ).scalars()
    staged = set(claimed.all())

    waiting = [key for key in keys.values() if key not in staged]
    if waiting:
        await _absorb(
            session,
            waiting,
            kind=kind,
            actor_user_id=actor_user_id,
            occurrence_date=occurrence_date,
            changes=changes,
            withdrawal=withdrawal,
            due=due,
            now=moment,
        )
    return len(recipients)


async def claim_event_mail(
    session: AsyncSession, delivery_id: UUID, now: datetime
) -> NotificationEmailDelivery | None:
    delivery = await session.get(NotificationEmailDelivery, delivery_id)
    if (
        delivery is None
        or delivery.composer != EmailComposer.CALENDAR
        or delivery.content_id is None
    ):
        return None
    await _lock_event_mail(session, delivery.content_id)
    await session.refresh(delivery)
    return await claim_email_delivery(session, delivery_id, now)


async def stage_event_mail_retry(
    session: AsyncSession,
    delivery: NotificationEmailDelivery,
    *,
    attempt: int,
    now: datetime,
) -> int | None:
    """Fold failed sends into newer pending mail before releasing their lease."""
    request = read_event_mail(delivery)
    if request is None:
        raise ValueError("Calendar delivery required")
    await _lock_event_mail(session, request.event_id)
    successor = await session.scalar(
        select(NotificationEmailDelivery)
        .where(
            NotificationEmailDelivery.coalesce_key == delivery.coalesce_key,
            NotificationEmailDelivery.id != delivery.id,
            NotificationEmailDelivery.status == NotificationEmailStatus.PENDING,
        )
        .with_for_update()
    )
    if successor is not None:
        metadata = coalesce_metadata(
            delivery.notification_metadata or {}, successor.notification_metadata or {}
        )
        successor.notification_metadata = metadata
        successor.notification_type = _NOTIFICATION_TYPES[CalendarMailKind[metadata["kind"]]].value
        successor.updated_at = now
        terminal_email_delivery(
            delivery,
            NotificationEmailStatus.SKIPPED,
            NotificationEmailTerminalReason.SUPERSEDED,
            now,
        )
        return None
    return retry_email_deliveries([delivery], attempt=attempt, now=now)


async def _lock_event_mail(session: AsyncSession, event_id: UUID) -> None:
    await session.execute(
        select(func.pg_advisory_xact_lock(func.hashtextextended(f"calendar-mail:{event_id}", 0)))
    )


async def retire_pending_event_mail(
    session: AsyncSession,
    event_id: UUID,
    recipient_ids: Sequence[UUID],
    now: datetime,
) -> None:
    """Somebody uninvited before the message goes out should not receive it."""
    if not recipient_ids:
        return
    await session.execute(
        update(NotificationEmailDelivery)
        .where(
            NotificationEmailDelivery.composer == EmailComposer.CALENDAR.value,
            NotificationEmailDelivery.content_id == event_id,
            NotificationEmailDelivery.user_id.in_(recipient_ids),
            NotificationEmailDelivery.status == NotificationEmailStatus.PENDING,
        )
        .values(
            status=NotificationEmailStatus.SKIPPED,
            terminal_reason=NotificationEmailTerminalReason.ACCESS_REVOKED.value,
            lease_expires_at=None,
            updated_at=now,
        )
    )


def read_event_mail(delivery: NotificationEmailDelivery) -> EventMailRequest | None:
    """The calendar view of a shared row, or None if it is not event mail."""
    metadata = delivery.notification_metadata or {}
    kind = metadata.get("kind")
    if delivery.composer != EmailComposer.CALENDAR or delivery.content_id is None:
        return None
    if kind not in CalendarMailKind.__members__:
        return None

    occurrence = metadata.get("occurrence_date")
    try:
        occurrence_date = date.fromisoformat(occurrence) if occurrence else None
        withdrawal = (
            EventWithdrawal.model_validate(metadata[_WITHDRAWAL])
            if _WITHDRAWAL in metadata
            else None
        )
    except ValidationError, ValueError, TypeError:
        return None
    if withdrawal is not None and kind != CalendarMailKind.CANCELLATION:
        return None
    return EventMailRequest(
        delivery_id=delivery.id,
        organization_id=delivery.organization_id,
        recipient_id=delivery.user_id,
        event_id=delivery.content_id,
        kind=CalendarMailKind[kind],
        occurrence_date=occurrence_date,
        changes=tuple(metadata.get("changes") or ()),
        withdrawal=withdrawal,
    )


def coalesce_metadata(held: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    """Retain the strongest message kind and every changed aspect."""
    ranked = held.get("kind") in CalendarMailKind.__members__ and (
        _PRECEDENCE[CalendarMailKind[held["kind"]]]
        >= _PRECEDENCE[CalendarMailKind[incoming["kind"]]]
    )
    winner = held if ranked else incoming
    result = {
        "kind": winner["kind"],
        "occurrence_date": winner.get("occurrence_date"),
        "changes": sorted(set(held.get("changes") or ()) | set(incoming.get("changes") or ())),
    }
    withdrawals = [value[_WITHDRAWAL] for value in (held, incoming) if _WITHDRAWAL in value]
    if withdrawals:
        result[_WITHDRAWAL] = {
            **max(withdrawals, key=lambda value: value["sequence"]),
            "this_and_following": any(value["this_and_following"] for value in withdrawals),
        }
    return result


async def _absorb(
    session: AsyncSession,
    keys: Sequence[str],
    *,
    kind: CalendarMailKind,
    actor_user_id: UUID | None,
    occurrence_date: date | None,
    changes: Iterable[str],
    withdrawal: EventWithdrawal | None,
    due: datetime,
    now: datetime,
) -> None:
    rows = (
        (
            await session.execute(
                select(NotificationEmailDelivery)
                .where(
                    NotificationEmailDelivery.coalesce_key.in_(keys),
                    NotificationEmailDelivery.status == NotificationEmailStatus.PENDING,
                )
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    incoming = _metadata(kind, occurrence_date, changes, withdrawal)
    for row in rows:
        metadata = coalesce_metadata(row.notification_metadata or {}, incoming)
        row.notification_metadata = metadata
        if _WITHDRAWAL in metadata:
            row.title = "Meeting cancelled"
        row.notification_type = _NOTIFICATION_TYPES[CalendarMailKind[metadata["kind"]]].value
        if metadata["kind"] == kind.value:
            row.actor_id = actor_user_id
        # An edit must not push an already-due message further out.
        row.scheduled_for = min(row.scheduled_for, due)
        row.updated_at = now


def _metadata(
    kind: CalendarMailKind,
    occurrence_date: date | None,
    changes: Iterable[str],
    withdrawal: EventWithdrawal | None = None,
) -> dict[str, Any]:
    metadata = {
        "kind": kind.value,
        "occurrence_date": occurrence_date.isoformat() if occurrence_date else None,
        "changes": sorted(set(changes)),
    }
    if withdrawal is not None:
        if kind is not CalendarMailKind.CANCELLATION:
            raise ValueError("Only cancellations can carry withdrawal identity")
        metadata[_WITHDRAWAL] = withdrawal.model_dump(mode="json")
    return metadata


def _coalesce_key(event_id: UUID, occurrence_date: date | None, recipient_id: UUID) -> str:
    # Withdrawing one occurrence is its own message; it must not swallow the
    # invitation to the series it belongs to.
    scope = occurrence_date.isoformat() if occurrence_date else "series"
    return f"calendar:{event_id}:{scope}:{recipient_id}"
