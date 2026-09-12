"""Event mail: a per-minute sweep, then one job per message owed."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.jobs import enqueue_job
from uniffy.core.mail import (
    MailNotConfiguredError,
    MailProviderError,
    MailRateLimitedError,
    MailSender,
    MailSuppressedError,
)
from uniffy.core.models.notifications.email_delivery import (
    EmailComposer,
    NotificationEmailDelivery,
    NotificationEmailStatus,
)
from uniffy.domains.notifications.delivery.outbox import (
    NotificationEmailTerminalReason,
    claim_email_delivery,
    claimable_email_predicate,
    mark_email_deliveries_sent,
    prepare_email_recipient,
    retry_email_deliveries,
    terminal_email_delivery,
)
from uniffy.domains.scheduling.calendar.jobs.contracts import SEND_EVENT_MAIL
from uniffy.domains.scheduling.calendar.mail.compose import load_bundle, send_event_mail
from uniffy.domains.scheduling.calendar.mail.outbox import CalendarMailKind, read_event_mail
from uniffy.infrastructure.database import open_session
from uniffy.vendor.arq import Retry

logger = logger.bind(component="scheduling.calendar.jobs.event_mail")

_DISPATCH_LIMIT = 500

_sender: MailSender | None = None


def _get_sender() -> MailSender:
    global _sender
    if _sender is None:
        _sender = MailSender()
    return _sender


async def dispatch_calendar_event_mail(ctx: dict[str, Any]) -> dict[str, Any]:
    """Hand every due message its own job, so one send owns one transaction."""
    now = datetime.now(UTC)
    async with open_session() as session:
        due = (
            (
                await session.execute(
                    select(NotificationEmailDelivery.id)
                    .where(
                        NotificationEmailDelivery.composer == EmailComposer.CALENDAR.value,
                        NotificationEmailDelivery.scheduled_for <= now,
                        claimable_email_predicate(now),
                    )
                    .order_by(NotificationEmailDelivery.scheduled_for)
                    .limit(_DISPATCH_LIMIT)
                )
            )
            .scalars()
            .all()
        )

    queued = 0
    for delivery_id in due:
        try:
            await enqueue_job(
                SEND_EVENT_MAIL,
                str(delivery_id),
                _job_id=f"calendar_event_mail:{delivery_id}",
            )
            queued += 1
        except Exception:
            logger.opt(exception=True).warning(f"Could not enqueue event mail {delivery_id}")

    return {"status": "success", "due": len(due), "queued": queued}


async def send_calendar_event_mail(ctx: dict[str, Any], delivery_id: str) -> dict[str, Any]:
    """Send one message, against the meeting and the roster as they stand now."""
    now = datetime.now(UTC)
    async with open_session() as session:
        delivery = await claim_email_delivery(session, UUID(delivery_id), now)
        if delivery is None:
            return {"status": "skipped", "reason": "not_claimable"}

        request = read_event_mail(delivery)
        if request is None:
            terminal_email_delivery(
                delivery,
                NotificationEmailStatus.SKIPPED,
                NotificationEmailTerminalReason.ACCESS_REVOKED,
                now,
            )
            await session.commit()
            return {"status": "skipped", "reason": "not_event_mail"}

        recipient = await prepare_email_recipient(session, [delivery], now)
        if recipient is None or delivery.status != NotificationEmailStatus.PROCESSING:
            await session.commit()
            return {"status": "skipped", "reason": delivery.terminal_reason}

        # A meeting erased outright leaves nothing to describe, and somebody
        # taken off the roster since the edit must not hear about it either.
        bundle = await load_bundle(session, request.event_id)
        still_owed = bundle is not None and (
            request.kind is CalendarMailKind.CANCELLATION
            or request.recipient_id in bundle.attendee_ids
        )
        if bundle is None or not still_owed:
            terminal_email_delivery(
                delivery,
                NotificationEmailStatus.SKIPPED,
                NotificationEmailTerminalReason.ACCESS_REVOKED,
                now,
            )
            await session.commit()
            return {
                "status": "skipped",
                "reason": NotificationEmailTerminalReason.ACCESS_REVOKED.value,
            }

        try:
            result = await send_event_mail(request, bundle, recipient, sender=_get_sender())
        except MailSuppressedError:
            terminal_email_delivery(
                delivery,
                NotificationEmailStatus.SUPPRESSED,
                NotificationEmailTerminalReason.SUPPRESSION_LIST,
                now,
            )
        except MailNotConfiguredError:
            terminal_email_delivery(
                delivery,
                NotificationEmailStatus.SKIPPED,
                NotificationEmailTerminalReason.MAIL_NOT_CONFIGURED,
                now,
            )
        except MailProviderError, MailRateLimitedError:
            logger.opt(exception=True).warning(
                "Event mail failed",
                event_id=str(request.event_id),
                delivery_id=delivery_id,
            )
            return await _retry_or_fail(session, delivery, ctx, now)
        else:
            mark_email_deliveries_sent([delivery], result.provider_message_id, now)

        await session.commit()
        return {"status": str(delivery.status), "delivery_id": delivery_id}


async def _retry_or_fail(
    session: AsyncSession,
    delivery: NotificationEmailDelivery,
    ctx: dict[str, Any],
    now: datetime,
) -> dict[str, Any]:
    delay_seconds = retry_email_deliveries(
        [delivery],
        attempt=int(ctx.get("job_try", 1)),
        now=now,
    )
    await session.commit()
    if delay_seconds is not None:
        raise Retry(defer=delay_seconds)
    return {"status": "failed", "reason": NotificationEmailTerminalReason.DELIVERY_FAILED.value}
