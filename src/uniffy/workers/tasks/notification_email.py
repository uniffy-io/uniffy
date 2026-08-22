"""Dispatch durable notification email deliveries."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.mail import (
    MailNotConfiguredError,
    MailProviderError,
    MailRateLimitedError,
    MailSender,
    MailSuppressedError,
)
from uniffy.core.models.notifications.email_delivery import (
    NotificationEmailDelivery,
    NotificationEmailStatus,
)
from uniffy.core.valkey.presence import presence_get_bulk
from uniffy.core.valkey.queue import QueueName, get_queue
from uniffy.db import open_session
from uniffy.domains.notifications.delivery.timing import quiet_hours_end_at, resolve_timezone
from uniffy.domains.notifications.email_content import (
    notification_action_url,
    notification_preferences_url,
    notification_preview,
    notifications_url,
)
from uniffy.domains.notifications.email_outbox import (
    NotificationEmailTerminalReason,
    RecipientContext,
    claim_email_delivery,
    claim_email_digest,
    claimable_email_predicate,
    mark_email_deliveries_sent,
    prepare_email_recipient,
    purge_terminal_email_deliveries,
    release_email_delivery,
    terminal_email_delivery,
)
from uniffy.domains.settings.defaults import EmailFrequency
from uniffy.vendor.arq import Retry
from uniffy.workers.tasks import JobName

logger = logger.bind(component="tasks.notification_email")

_DISPATCH_LIMIT = 500
_DIGEST_RENDER_LIMIT = 50
_ACTIVE_DEFER = timedelta(minutes=15)
_MAX_ATTEMPTS = 5


class NotificationEmailTemplate(StrEnum):
    INSTANT = "notifications/instant"
    DIGEST = "notifications/digest"


_sender: MailSender | None = None


def _get_sender() -> MailSender:
    global _sender
    if _sender is None:
        _sender = MailSender()
    return _sender


async def dispatch_notification_emails(ctx: dict[str, Any]) -> dict[str, Any]:
    now = datetime.now(UTC)
    async with open_session() as session:
        rows = (
            (
                await session.execute(
                    select(NotificationEmailDelivery)
                    .where(
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
        purged = await purge_terminal_email_deliveries(session, now)
        await session.commit()

    instant_ids: list[UUID] = []
    digest_groups: set[tuple[UUID, UUID, str, datetime]] = set()
    for row in rows:
        if row.frequency == EmailFrequency.INSTANT.value:
            instant_ids.append(row.id)
        else:
            digest_groups.add((row.organization_id, row.user_id, row.frequency, row.scheduled_for))

    queued = 0
    queue = get_queue(QueueName.CORE)
    for delivery_id in instant_ids:
        try:
            await queue.enqueue_job(
                JobName.SEND_NOTIFICATION_EMAIL,
                str(delivery_id),
                _job_id=f"notification_email:{delivery_id}",
            )
            queued += 1
        except Exception:
            logger.opt(exception=True).warning(f"Could not enqueue notification email {delivery_id}")

    for organization_id, user_id, frequency, window_end in digest_groups:
        window_key = window_end.isoformat()
        try:
            await queue.enqueue_job(
                JobName.SEND_NOTIFICATION_DIGEST,
                str(organization_id),
                str(user_id),
                frequency,
                window_key,
                _job_id=(
                    f"notification_digest:{organization_id}:{user_id}:{frequency}:{window_key}"
                ),
            )
            queued += 1
        except Exception:
            logger.opt(exception=True).warning(
                f"Could not enqueue notification digest for {user_id} in {organization_id}"
            )

    return {"status": "success", "due": len(rows), "queued": queued, "purged": purged}


async def send_notification_email(
    ctx: dict[str, Any],
    delivery_id: str,
) -> dict[str, Any]:
    now = datetime.now(UTC)
    async with open_session() as session:
        delivery = await claim_email_delivery(session, UUID(delivery_id), now)
        if delivery is None:
            return {"status": "skipped", "reason": "not_claimable"}

        recipient = await prepare_email_recipient(session, [delivery], now)
        if recipient is None:
            await session.commit()
            return {"status": "skipped", "reason": delivery.terminal_reason}

        if delivery.status != NotificationEmailStatus.PROCESSING:
            await session.commit()
            return {"status": "skipped", "reason": delivery.terminal_reason}

        quiet_end = quiet_hours_end_at(
            recipient.notification_overrides,
            recipient.timezone,
            at=now,
        )
        if quiet_end is not None:
            release_email_delivery(delivery, scheduled_for=quiet_end, now=now)
            await session.commit()
            return {"status": "deferred", "reason": "quiet_hours"}

        context = _instant_context(delivery, recipient)
        try:
            result = await _get_sender().send(
                recipient_email=recipient.user.email,
                template_name=NotificationEmailTemplate.INSTANT,
                context=context,
                organization_id=delivery.organization_id,
                idempotency_key=f"notification/{delivery.event_id}/{delivery.user_id}",
                user_id=delivery.user_id,
            )
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
            return await _retry_or_fail(session, [delivery], ctx, now)
        else:
            mark_email_deliveries_sent([delivery], result.provider_message_id, now)

        await session.commit()
        return {"status": str(delivery.status), "delivery_id": delivery_id}


async def send_notification_digest(
    ctx: dict[str, Any],
    organization_id: str,
    user_id: str,
    frequency: str,
    window_end: str,
) -> dict[str, Any]:
    now = datetime.now(UTC)
    window = datetime.fromisoformat(window_end)
    if window.tzinfo is None:
        window = window.replace(tzinfo=UTC)

    async with open_session() as session:
        deliveries = await claim_email_digest(
            session,
            UUID(organization_id),
            UUID(user_id),
            frequency,
            window,
            now,
        )
        if not deliveries:
            return {"status": "skipped", "reason": "not_claimable"}

        recipient = await prepare_email_recipient(session, deliveries, now)
        valid = [
            delivery
            for delivery in deliveries
            if delivery.status == NotificationEmailStatus.PROCESSING
        ]
        if recipient is None or not valid:
            await session.commit()
            return {"status": "skipped", "reason": "no_deliverable_items"}

        quiet_end = quiet_hours_end_at(
            recipient.notification_overrides,
            recipient.timezone,
            at=now,
        )
        if quiet_end is not None:
            for delivery in valid:
                release_email_delivery(delivery, scheduled_for=quiet_end, now=now)
            await session.commit()
            return {"status": "deferred", "reason": "quiet_hours"}

        presence = await presence_get_bulk(deliveries[0].organization_id, [deliveries[0].user_id])
        if str(deliveries[0].user_id) in presence:
            for delivery in valid:
                release_email_delivery(delivery, scheduled_for=now + _ACTIVE_DEFER, now=now)
            await session.commit()
            return {"status": "deferred", "reason": "recipient_active"}

        context = _digest_context(valid, recipient)
        idempotency_key = (
            f"notification_digest/{organization_id}/{user_id}/{frequency}/{window.isoformat()}"
        )
        try:
            result = await _get_sender().send(
                recipient_email=recipient.user.email,
                template_name=NotificationEmailTemplate.DIGEST,
                context=context,
                organization_id=deliveries[0].organization_id,
                idempotency_key=idempotency_key,
                user_id=deliveries[0].user_id,
            )
        except MailSuppressedError:
            for delivery in valid:
                terminal_email_delivery(
                    delivery,
                    NotificationEmailStatus.SUPPRESSED,
                    NotificationEmailTerminalReason.SUPPRESSION_LIST,
                    now,
                )
        except MailNotConfiguredError:
            for delivery in valid:
                terminal_email_delivery(
                    delivery,
                    NotificationEmailStatus.SKIPPED,
                    NotificationEmailTerminalReason.MAIL_NOT_CONFIGURED,
                    now,
                )
        except MailProviderError, MailRateLimitedError:
            return await _retry_or_fail(session, valid, ctx, now)
        else:
            mark_email_deliveries_sent(valid, result.provider_message_id, now)

        await session.commit()
        return {"status": str(valid[0].status), "deliveries": len(valid)}


def _instant_context(
    delivery: NotificationEmailDelivery,
    recipient: RecipientContext,
) -> dict[str, Any]:
    return {
        "organization_name": notification_preview(recipient.organization.name, limit=200),
        "actor_name": notification_preview(
            recipient.actor_names.get(delivery.actor_id, ""),
            limit=200,
        ),
        "title": notification_preview(delivery.title, limit=200),
        "body": notification_preview(delivery.body),
        "action_url": notification_action_url(delivery),
        "preferences_url": notification_preferences_url(),
    }


def _digest_context(
    deliveries: list[NotificationEmailDelivery],
    recipient: RecipientContext,
) -> dict[str, Any]:
    zone = resolve_timezone(recipient.timezone)
    rendered = deliveries[:_DIGEST_RENDER_LIMIT]
    return {
        "organization_name": notification_preview(recipient.organization.name, limit=200),
        "item_count": len(deliveries),
        "additional_count": max(0, len(deliveries) - len(rendered)),
        "items": [
            {
                "actor_name": notification_preview(
                    recipient.actor_names.get(delivery.actor_id, ""),
                    limit=200,
                ),
                "title": notification_preview(delivery.title, limit=200),
                "body": notification_preview(delivery.body, limit=240),
                "action_url": notification_action_url(delivery),
                "created_at": delivery.created_at.astimezone(zone).strftime("%b %-d, %H:%M"),
            }
            for delivery in rendered
        ],
        "notifications_url": notifications_url(),
        "preferences_url": notification_preferences_url(),
    }


async def _retry_or_fail(
    session: AsyncSession,
    deliveries: list[NotificationEmailDelivery],
    ctx: dict[str, Any],
    now: datetime,
) -> dict[str, Any]:
    retryable: list[NotificationEmailDelivery] = []
    delay_seconds = max(60, int(ctx.get("job_try", 1)) * 60)
    for delivery in deliveries:
        if delivery.attempt_count >= _MAX_ATTEMPTS:
            terminal_email_delivery(
                delivery,
                NotificationEmailStatus.FAILED,
                NotificationEmailTerminalReason.DELIVERY_FAILED,
                now,
            )
        else:
            release_email_delivery(
                delivery,
                scheduled_for=now + timedelta(seconds=delay_seconds),
                now=now,
            )
            retryable.append(delivery)
    await session.commit()
    if retryable:
        raise Retry(defer=delay_seconds)
    return {
        "status": "failed",
        "reason": NotificationEmailTerminalReason.DELIVERY_FAILED.value,
    }
