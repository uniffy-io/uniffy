"""Replay committed notification events after queue or worker failure."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from prometheus_client import Counter
from sqlalchemy import func, select

from uniffy.core.jobs import enqueue_job
from uniffy.core.models.notifications.outbox import NotificationOutbox
from uniffy.core.realtime.metrics import REALTIME_BACKLOG_DEPTH
from uniffy.domains.notifications.jobs.contracts import DELIVER_NOTIFICATION_OUTBOX
from uniffy.domains.notifications.jobs.jobs import process_notification_event
from uniffy.infrastructure.database.session import open_session

DELIVERY_ATTEMPTS = Counter(
    "uniffy_notification_outbox_attempts_total", "Durable notification delivery attempts"
)


async def deliver_notification_outbox(ctx: dict[str, Any], event_id: str) -> None:
    DELIVERY_ATTEMPTS.inc()
    async with open_session() as db:
        event = await db.get(NotificationOutbox, UUID(event_id))
        if event is None:
            return
        payload = event.payload
    result = await process_notification_event(ctx, payload)
    if result.get("status") not in ("success", "skipped"):
        raise RuntimeError("Notification outbox delivery failed")
    async with open_session() as db:
        event = await db.get(NotificationOutbox, UUID(event_id))
        if event is not None:
            await db.delete(event)
            await db.commit()


async def recover_notification_events(ctx: dict[str, Any]) -> None:
    async with open_session() as db:
        depth = await db.scalar(select(func.count()).select_from(NotificationOutbox))
        REALTIME_BACKLOG_DEPTH.labels(kind="notifications").set(depth or 0)
        events = (
            (
                await db.execute(
                    select(NotificationOutbox)
                    .order_by(NotificationOutbox.attempted_at)
                    .limit(100)
                    .with_for_update(skip_locked=True)
                )
            )
            .scalars()
            .all()
        )
        for event in events:
            event.attempted_at = datetime.now(UTC)
        await db.commit()
    for event in events:
        await enqueue_job(
            DELIVER_NOTIFICATION_OUTBOX,
            str(event.event_id),
            _job_id=f"notification-outbox:{event.event_id}",
        )
