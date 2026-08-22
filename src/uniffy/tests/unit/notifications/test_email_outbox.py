"""Delivery-time checks for durable notification email rows."""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.user import User
from uniffy.core.models.notifications.email_delivery import (
    NotificationEmailDelivery,
    NotificationEmailStatus,
)
from uniffy.core.types import ContentType, NotificationType, generate_id
from uniffy.domains.notifications.email_outbox import (
    NotificationEmailTerminalReason,
    prepare_email_recipient,
)
from uniffy.domains.permissions.resource_access import (
    ResourceAccessDecision,
    ResourceKey,
    ResourceRowState,
)


def _delivery(now: datetime, **overrides) -> NotificationEmailDelivery:
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


def _user(user_id, *, verified: bool = True) -> User:
    return User(
        id=user_id,
        email="member@example.com",
        username=f"member-{user_id}",
        email_verified=verified,
    )


def _organization(organization_id) -> Organization:
    return Organization(
        id=organization_id,
        name="Acme",
        slug=f"acme-{organization_id}",
    )


def _active_resolver():
    resolver = SimpleNamespace(
        subject=AsyncMock(return_value=SimpleNamespace(is_active_member=True)),
        resolve_page=AsyncMock(return_value={}),
    )
    return resolver


async def test_unverified_recipient_is_terminally_skipped() -> None:
    now = datetime(2026, 8, 21, 12, 0, tzinfo=UTC)
    delivery = _delivery(now)
    session = AsyncMock()
    session.get = AsyncMock(
        side_effect=[
            _user(delivery.user_id, verified=False),
            _organization(delivery.organization_id),
        ]
    )

    recipient = await prepare_email_recipient(session, [delivery], now)

    assert recipient is None
    assert delivery.status == NotificationEmailStatus.SKIPPED
    assert delivery.terminal_reason == NotificationEmailTerminalReason.EMAIL_UNVERIFIED.value


async def test_current_email_preference_is_rechecked_before_send() -> None:
    now = datetime(2026, 8, 21, 12, 0, tzinfo=UTC)
    delivery = _delivery(now)
    session = AsyncMock()
    session.get = AsyncMock(
        side_effect=[_user(delivery.user_id), _organization(delivery.organization_id)]
    )
    resolver = _active_resolver()

    with (
        patch(
            "uniffy.domains.notifications.email_outbox.load_notification_overrides",
            new=AsyncMock(return_value={"email_enabled": False}),
        ),
        patch(
            "uniffy.domains.notifications.email_outbox.get_user_timezone",
            new=AsyncMock(return_value="UTC"),
        ),
        patch(
            "uniffy.domains.notifications.email_outbox.ResourceAccessResolver",
            return_value=resolver,
        ),
    ):
        recipient = await prepare_email_recipient(session, [delivery], now)

    assert recipient is not None
    assert delivery.status == NotificationEmailStatus.SKIPPED
    assert delivery.terminal_reason == NotificationEmailTerminalReason.PREFERENCE_DISABLED.value


async def test_revoked_content_access_is_rechecked_before_send() -> None:
    now = datetime(2026, 8, 21, 12, 0, tzinfo=UTC)
    content_id = generate_id()
    delivery = _delivery(now, content_type=ContentType.NOTE, content_id=content_id)
    session = AsyncMock()
    session.get = AsyncMock(
        side_effect=[_user(delivery.user_id), _organization(delivery.organization_id)]
    )
    key = ResourceKey(ContentType.NOTE, content_id)
    resolver = _active_resolver()
    resolver.resolve_page.return_value = {
        key: ResourceAccessDecision(
            key=key,
            row_state=ResourceRowState.LIVE,
            can_view=False,
        )
    }

    with (
        patch(
            "uniffy.domains.notifications.email_outbox.load_notification_overrides",
            new=AsyncMock(return_value=None),
        ),
        patch(
            "uniffy.domains.notifications.email_outbox.get_user_timezone",
            new=AsyncMock(return_value="UTC"),
        ),
        patch(
            "uniffy.domains.notifications.email_outbox.ResourceAccessResolver",
            return_value=resolver,
        ),
    ):
        recipient = await prepare_email_recipient(session, [delivery], now)

    assert recipient is not None
    assert delivery.status == NotificationEmailStatus.SKIPPED
    assert delivery.terminal_reason == NotificationEmailTerminalReason.ACCESS_REVOKED.value
    resolver.resolve_page.assert_awaited_once()


async def test_frequency_change_reschedules_pending_delivery() -> None:
    now = datetime(2026, 8, 21, 12, 0, tzinfo=UTC)
    delivery = _delivery(now, created_at=datetime(2026, 8, 21, 10, 0, tzinfo=UTC))
    session = AsyncMock()
    session.get = AsyncMock(
        side_effect=[_user(delivery.user_id), _organization(delivery.organization_id)]
    )
    resolver = _active_resolver()

    with (
        patch(
            "uniffy.domains.notifications.email_outbox.load_notification_overrides",
            new=AsyncMock(
                return_value={"email_frequency": "daily", "email_digest_time": "14:00"}
            ),
        ),
        patch(
            "uniffy.domains.notifications.email_outbox.get_user_timezone",
            new=AsyncMock(return_value="UTC"),
        ),
        patch(
            "uniffy.domains.notifications.email_outbox.ResourceAccessResolver",
            return_value=resolver,
        ),
    ):
        recipient = await prepare_email_recipient(session, [delivery], now)

    assert recipient is not None
    assert delivery.status == NotificationEmailStatus.PENDING
    assert delivery.frequency == "daily"
    assert delivery.scheduled_for == datetime(2026, 8, 21, 14, 0, tzinfo=UTC)

