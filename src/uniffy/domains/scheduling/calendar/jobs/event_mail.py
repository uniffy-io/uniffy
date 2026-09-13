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
from uniffy.core.types import ContentType
from uniffy.domains.notifications.delivery.outbox import (
    NotificationEmailTerminalReason,
    claimable_email_predicate,
    mark_email_deliveries_sent,
    prepare_email_recipient,
    prepare_transactional_email_recipient,
    terminal_email_delivery,
)
from uniffy.domains.permissions.access import ResourceAudienceResolver
from uniffy.domains.scheduling.calendar.jobs.contracts import SEND_EVENT_MAIL
from uniffy.domains.scheduling.calendar.mail.compose import (
    load_bundle,
    send_event_mail,
    send_withdrawal_mail,
)
from uniffy.domains.scheduling.calendar.mail.outbox import (
    CalendarMailKind,
    claim_event_mail,
    read_event_mail,
    stage_event_mail_retry,
)
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
        delivery = await claim_event_mail(session, UUID(delivery_id), now)
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

        recipient = (
            await prepare_transactional_email_recipient(session, delivery, now)
            if request.withdrawal is not None
            else await prepare_email_recipient(session, [delivery], now)
        )
        if recipient is None or delivery.status != NotificationEmailStatus.PROCESSING:
            await session.commit()
            return {"status": "skipped", "reason": delivery.terminal_reason}

        bundle = None
        if request.withdrawal is not None:
            blocked = await ResourceAudienceResolver(session).blocked_users(
                request.organization_id,
                ContentType.CALENDAR_EVENT,
                request.event_id,
                [request.recipient_id],
            )
            still_owed = request.recipient_id not in blocked
        else:
            bundle = await load_bundle(session, request.event_id)
            still_owed = bundle is not None and (
                request.kind is CalendarMailKind.CANCELLATION
                or request.recipient_id in bundle.attendee_ids
            )
        if not still_owed:
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
            if request.withdrawal is not None:
                result = await send_withdrawal_mail(request, recipient, sender=_get_sender())
            else:
                assert bundle is not None
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
    delay_seconds = await stage_event_mail_retry(
        session,
        delivery,
        attempt=int(ctx.get("job_try", 1)),
        now=now,
    )
    await session.commit()
    if delay_seconds is not None:
        raise Retry(defer=delay_seconds)
    return {"status": str(delivery.status), "reason": delivery.terminal_reason}
