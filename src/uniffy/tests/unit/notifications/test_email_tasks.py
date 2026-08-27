"""Notification email worker state transitions."""

from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest

from uniffy.core.mail import MailResult
from uniffy.core.mail.errors import MailProviderError
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.user import User
from uniffy.core.models.notifications.email_delivery import (
    NotificationEmailDelivery,
    NotificationEmailStatus,
)
from uniffy.core.types import NotificationType, generate_id
from uniffy.domains.notifications.email_outbox import RecipientContext
from uniffy.vendor.arq import Retry
from uniffy.domains.notifications.jobs.email import (
    send_notification_digest,
    send_notification_email,
)


def _delivery(**overrides) -> NotificationEmailDelivery:
    now = datetime.now(UTC) - timedelta(minutes=1)
    values = {
        "event_id": generate_id(),
        "organization_id": generate_id(),
        "user_id": generate_id(),
        "notification_type": NotificationType.CONTENT_MENTIONED,
        "title": "Mentioned you",
        "frequency": "instant",
        "status": NotificationEmailStatus.PROCESSING,
        "scheduled_for": now,
        "created_at": now,
        **overrides,
    }
    return NotificationEmailDelivery(**values)


def _recipient(delivery: NotificationEmailDelivery, overrides=None) -> RecipientContext:
    user = User(
        id=delivery.user_id,
        email="member@example.com",
        username="member",
        full_name="Member",
        email_verified=True,
    )
    organization = Organization(
        id=delivery.organization_id,
        name="Acme",
        slug=f"acme-{delivery.organization_id}",
    )
    return RecipientContext(
        user=user,
        organization=organization,
        notification_overrides=overrides,
        timezone="UTC",
        actor_names={},
    )


@asynccontextmanager
async def _session_context(session):
    yield session


async def test_instant_worker_marks_successful_delivery_sent() -> None:
    delivery = _delivery()
    recipient = _recipient(delivery)
    session = AsyncMock()
    sender = AsyncMock()
    sender.send.return_value = MailResult(success=True, provider_message_id="smtp-1")

    with (
        patch(
            "uniffy.domains.notifications.jobs.email.open_session",
            new=lambda: _session_context(session),
        ),
        patch(
            "uniffy.domains.notifications.jobs.email.claim_email_delivery",
            new=AsyncMock(return_value=delivery),
        ),
        patch(
            "uniffy.domains.notifications.jobs.email.prepare_email_recipient",
            new=AsyncMock(return_value=recipient),
        ),
        patch("uniffy.domains.notifications.jobs.email._get_sender", return_value=sender),
    ):
        result = await send_notification_email({}, str(delivery.id))

    assert result == {"status": "sent", "delivery_id": str(delivery.id)}
    assert delivery.status == NotificationEmailStatus.SENT
    assert delivery.provider_message_id == "smtp-1"
    sender.send.assert_awaited_once()
    session.commit.assert_awaited_once()


async def test_instant_worker_defers_during_quiet_hours() -> None:
    delivery = _delivery()
    recipient = _recipient(delivery)
    session = AsyncMock()
    quiet_end = datetime.now(UTC) + timedelta(hours=1)
    sender = AsyncMock()

    with (
        patch(
            "uniffy.domains.notifications.jobs.email.open_session",
            new=lambda: _session_context(session),
        ),
        patch(
            "uniffy.domains.notifications.jobs.email.claim_email_delivery",
            new=AsyncMock(return_value=delivery),
        ),
        patch(
            "uniffy.domains.notifications.jobs.email.prepare_email_recipient",
            new=AsyncMock(return_value=recipient),
        ),
        patch(
            "uniffy.domains.notifications.jobs.email.quiet_hours_end_at",
            return_value=quiet_end,
        ),
        patch("uniffy.domains.notifications.jobs.email._get_sender", return_value=sender),
    ):
        result = await send_notification_email({}, str(delivery.id))

    assert result == {"status": "deferred", "reason": "quiet_hours"}
    assert delivery.status == NotificationEmailStatus.PENDING
    assert delivery.scheduled_for == quiet_end
    sender.send.assert_not_awaited()


async def test_digest_worker_sends_all_claimed_items_together() -> None:
    organization_id = generate_id()
    user_id = generate_id()
    first = _delivery(
        organization_id=organization_id,
        user_id=user_id,
        frequency="hourly",
    )
    second = _delivery(
        organization_id=organization_id,
        user_id=user_id,
        frequency="hourly",
    )
    recipient = _recipient(first)
    session = AsyncMock()
    sender = AsyncMock()
    sender.send.return_value = MailResult(success=True, provider_message_id="smtp-digest")
    window = datetime.now(UTC)

    with (
        patch(
            "uniffy.domains.notifications.jobs.email.open_session",
            new=lambda: _session_context(session),
        ),
        patch(
            "uniffy.domains.notifications.jobs.email.claim_email_digest",
            new=AsyncMock(return_value=[first, second]),
        ),
        patch(
            "uniffy.domains.notifications.jobs.email.prepare_email_recipient",
            new=AsyncMock(return_value=recipient),
        ),
        patch(
            "uniffy.domains.notifications.jobs.email.presence_get_bulk",
            new=AsyncMock(return_value={}),
        ),
        patch("uniffy.domains.notifications.jobs.email._get_sender", return_value=sender),
    ):
        result = await send_notification_digest(
            {},
            str(organization_id),
            str(user_id),
            "hourly",
            window.isoformat(),
        )

    assert result == {"status": "sent", "deliveries": 2}
    assert first.status == NotificationEmailStatus.SENT
    assert second.status == NotificationEmailStatus.SENT
    sender.send.assert_awaited_once()


async def test_provider_failure_releases_delivery_before_retry() -> None:
    delivery = _delivery(attempt_count=1)
    recipient = _recipient(delivery)
    session = AsyncMock()
    sender = AsyncMock()
    sender.send.side_effect = MailProviderError("temporary failure")

    with (
        patch(
            "uniffy.domains.notifications.jobs.email.open_session",
            new=lambda: _session_context(session),
        ),
        patch(
            "uniffy.domains.notifications.jobs.email.claim_email_delivery",
            new=AsyncMock(return_value=delivery),
        ),
        patch(
            "uniffy.domains.notifications.jobs.email.prepare_email_recipient",
            new=AsyncMock(return_value=recipient),
        ),
        patch("uniffy.domains.notifications.jobs.email._get_sender", return_value=sender),
        pytest.raises(Retry),
    ):
        await send_notification_email({"job_try": 2}, str(delivery.id))

    assert delivery.status == NotificationEmailStatus.PENDING
    assert delivery.lease_expires_at is None
    assert delivery.scheduled_for > datetime.now(UTC)
    session.commit.assert_awaited_once()


async def test_provider_failure_becomes_terminal_after_max_attempts() -> None:
    delivery = _delivery(attempt_count=5)
    recipient = _recipient(delivery)
    session = AsyncMock()
    sender = AsyncMock()
    sender.send.side_effect = MailProviderError("permanent failure")

    with (
        patch(
            "uniffy.domains.notifications.jobs.email.open_session",
            new=lambda: _session_context(session),
        ),
        patch(
            "uniffy.domains.notifications.jobs.email.claim_email_delivery",
            new=AsyncMock(return_value=delivery),
        ),
        patch(
            "uniffy.domains.notifications.jobs.email.prepare_email_recipient",
            new=AsyncMock(return_value=recipient),
        ),
        patch("uniffy.domains.notifications.jobs.email._get_sender", return_value=sender),
    ):
        result = await send_notification_email({"job_try": 5}, str(delivery.id))

    assert result == {"status": "failed", "reason": "delivery_failed"}
    assert delivery.status == NotificationEmailStatus.FAILED
    assert delivery.terminal_reason == "delivery_failed"
    session.commit.assert_awaited_once()
