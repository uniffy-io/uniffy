"""Per-minute cron: send the event mail owed since the last pass."""

from collections import defaultdict
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.mail import MailSender
from uniffy.core.models.calendar.activity import EventActivity
from uniffy.core.models.calendar.mail_delivery import (
    CalendarMailDelivery,
    CalendarMailKind,
)
from uniffy.domains.notifications.preferences import load_notification_overrides
from uniffy.domains.scheduling.calendar.mail.compose import load_bundle, send_delivery
from uniffy.domains.scheduling.calendar.mail.outbox import (
    claim_due_deliveries,
    mark_failed,
    mark_sent,
)
from uniffy.domains.scheduling.calendar.mail.staging import (
    MAIL_TRIGGERING_ACTIONS,
    describe_changes,
)
from uniffy.domains.settings.operations import get_user_timezone
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="scheduling.calendar.jobs.event_mail")

_sender: MailSender | None = None


def _get_sender() -> MailSender:
    global _sender
    if _sender is None:
        _sender = MailSender()
    return _sender


async def dispatch_calendar_event_mail(ctx: dict[str, Any]) -> dict[str, Any]:
    """Claim every due row, then send one message per recipient.

    Rows are grouped by event so the document and the roster are built once for
    everyone hearing about the same meeting. A recipient whose preference says
    no is settled, not retried - the row is done either way.
    """
    now = datetime.now(UTC)
    sent = 0
    skipped = 0
    failed = 0

    async with open_session() as session:
        claimed = await claim_due_deliveries(session, now=now)
        if not claimed:
            await session.commit()
            return {"sent": 0, "skipped": 0, "failed": 0}

        by_event: dict[UUID, list[CalendarMailDelivery]] = defaultdict(list)
        for delivery in claimed:
            by_event[delivery.event_id].append(delivery)

        for event_id, deliveries in by_event.items():
            bundle = await load_bundle(session, event_id)
            if bundle is None:
                # The event is gone; there is nothing left to describe.
                await mark_sent(session, deliveries, now)
                skipped += len(deliveries)
                continue

            for delivery in deliveries:
                try:
                    delivered = await send_delivery(
                        session,
                        delivery,
                        bundle,
                        sender=_get_sender(),
                        overrides_loader=load_notification_overrides,
                        timezone_loader=get_user_timezone,
                        changes=await _changes_since(session, delivery),
                    )
                except Exception as exc:  # noqa: BLE001 - one bad recipient must not stop the pass
                    logger.opt(exception=True).warning(
                        "Event mail failed",
                        event_id=str(event_id),
                        delivery_id=str(delivery.id),
                    )
                    await mark_failed(session, [delivery], now, str(exc))
                    failed += 1
                    continue

                await mark_sent(session, [delivery], now)
                if delivered:
                    sent += 1
                else:
                    skipped += 1

        await session.commit()

    if sent or failed:
        logger.info("Event mail pass complete", sent=sent, skipped=skipped, failed=failed)
    return {"sent": sent, "skipped": skipped, "failed": failed}


async def _changes_since(session, delivery: CalendarMailDelivery) -> list[str]:
    """What moved while this message was waiting to go out.

    Read from the activity log rather than carried on the row: several edits
    coalesce onto one delivery, and the log already holds every one of them.
    """
    if delivery.kind is not CalendarMailKind.CHANGE:
        return []
    actions = (
        (
            await session.execute(
                select(EventActivity.action).where(
                    EventActivity.event_id == delivery.event_id,
                    EventActivity.created_at >= delivery.created_at,
                    EventActivity.action.in_(MAIL_TRIGGERING_ACTIONS),
                )
            )
        )
        .scalars()
        .all()
    )
    return describe_changes(set(actions))
