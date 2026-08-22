"""PostgreSQL guarantees for durable notification email staging."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import delete, select

from uniffy.core.events import NotificationEvent
from uniffy.core.models.notifications.email_delivery import (
    NotificationEmailDelivery,
    NotificationEmailStatus,
)
from uniffy.core.types import NotificationType, generate_id
from uniffy.domains.notifications.delivery.email import EmailAdapter

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_staging_is_idempotent_per_event_and_recipient(session, env) -> None:
    event = NotificationEvent(
        notification_type=NotificationType.CHAT_MENTION,
        organization_id=env.org_id,
        actor_id=env.member_id,
        title="Mentioned you",
        body="Review the thread",
        source_urn=f"urn:uniffy:content:CHAT:{generate_id()}",
        metadata={"channel_id": str(generate_id()), "message_id": str(generate_id())},
    )
    adapter = EmailAdapter()
    now = datetime(2026, 8, 21, 12, 0, tzinfo=UTC)

    first = await adapter.stage_with_session(
        session,
        env.admin_id,
        event,
        {"email_frequency": "instant"},
        timezone="UTC",
        at=now,
    )
    duplicate = await adapter.stage_with_session(
        session,
        env.admin_id,
        event,
        {"email_frequency": "instant"},
        timezone="UTC",
        at=now,
    )
    await session.commit()

    try:
        assert first is not None
        assert duplicate is None
        row = (
            await session.execute(
                select(NotificationEmailDelivery).where(
                    NotificationEmailDelivery.id == first.id
                )
            )
        ).scalar_one()
        assert row.event_id == event.event_id
        assert row.status == NotificationEmailStatus.PENDING
        assert row.notification_type == NotificationType.CHAT_MENTION
        assert row.scheduled_for == now
    finally:
        await session.execute(
            delete(NotificationEmailDelivery).where(
                NotificationEmailDelivery.event_id == event.event_id
            )
        )
        await session.commit()
