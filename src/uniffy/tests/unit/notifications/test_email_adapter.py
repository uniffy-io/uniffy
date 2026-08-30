"""Durable notification email staging and queue dispatch."""

from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.events.types import NotificationEvent
from uniffy.core.types import NotificationType, generate_id
from uniffy.domains.notifications.delivery.base import NotificationChannel
from uniffy.domains.notifications.delivery.email import EmailAdapter, StagedEmailDelivery
from uniffy.domains.notifications.jobs.contracts import SEND_NOTIFICATION_EMAIL
from uniffy.domains.settings.defaults import EmailFrequency


def _event(organization_id):
    return NotificationEvent(
        notification_type=NotificationType.CONTENT_MENTIONED,
        organization_id=organization_id,
        actor_id=generate_id(),
        title="Jane mentioned you",
        body="See the planning doc",
        source_urn=f"urn:uniffy:content:NOTE:{generate_id()}",
    )


@asynccontextmanager
async def _fake_session(session_mock):
    yield session_mock


async def test_stage_instant_email_returns_durable_delivery() -> None:
    delivery_id = generate_id()
    session = AsyncMock()
    session.execute.return_value = MagicMock(scalar_one_or_none=MagicMock(return_value=delivery_id))
    now = datetime(2026, 8, 21, 12, 0, tzinfo=UTC)

    staged = await EmailAdapter(MagicMock()).stage_with_session(
        session,
        generate_id(),
        _event(generate_id()),
        {"email_frequency": "instant"},
        timezone="UTC",
        at=now,
    )

    assert staged == StagedEmailDelivery(
        id=delivery_id,
        frequency=EmailFrequency.INSTANT,
        scheduled_for=now,
    )
    session.execute.assert_awaited_once()


async def test_instant_delivery_enqueues_stable_outbox_job() -> None:
    delivery = StagedEmailDelivery(
        id=generate_id(),
        frequency=EmailFrequency.INSTANT,
        scheduled_for=datetime.now(UTC) - timedelta(seconds=1),
    )
    queue = AsyncMock()

    with patch(
        "uniffy.domains.notifications.delivery.email.enqueue_job",
        new=queue.enqueue_job,
    ):
        result = await EmailAdapter(MagicMock()).enqueue_if_due(delivery)

    assert result is True
    queue.enqueue_job.assert_awaited_once_with(
        SEND_NOTIFICATION_EMAIL,
        str(delivery.id),
        _job_id=f"notification_email:{delivery.id}",
    )


async def test_digest_delivery_waits_for_dispatcher() -> None:
    delivery = StagedEmailDelivery(
        id=generate_id(),
        frequency=EmailFrequency.HOURLY,
        scheduled_for=datetime.now(UTC),
    )
    queue = AsyncMock()

    with patch(
        "uniffy.domains.notifications.delivery.email.enqueue_job",
        new=queue.enqueue_job,
    ):
        result = await EmailAdapter(MagicMock()).enqueue_if_due(delivery)

    assert result is True
    queue.enqueue_job.assert_not_awaited()


async def test_standalone_delivery_respects_email_preference() -> None:
    session = AsyncMock()

    with patch(
        "uniffy.domains.notifications.delivery.email.get_delivery_preferences",
        new=AsyncMock(return_value=({NotificationChannel.IN_APP}, None)),
    ):
        delivered = await EmailAdapter(lambda: _fake_session(session)).deliver(
            generate_id(),
            _event(generate_id()),
        )

    assert delivered is False
    session.commit.assert_not_awaited()
