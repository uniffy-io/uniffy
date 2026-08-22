"""Safe notification email copy and deep links."""

from datetime import UTC, datetime

from uniffy.core.models.notifications.email_delivery import NotificationEmailDelivery
from uniffy.core.types import ContentType, NotificationType, generate_id
from uniffy.domains.notifications.email_content import (
    notification_action_path,
    notification_preview,
)


def _delivery(**overrides) -> NotificationEmailDelivery:
    values = {
        "event_id": generate_id(),
        "organization_id": generate_id(),
        "user_id": generate_id(),
        "notification_type": NotificationType.CONTENT_MENTIONED,
        "title": "Mentioned you",
        "frequency": "instant",
        "scheduled_for": datetime.now(UTC),
        **overrides,
    }
    return NotificationEmailDelivery(**values)


def test_chat_email_targets_the_exact_message() -> None:
    channel_id = generate_id()
    message_id = generate_id()
    delivery = _delivery(
        notification_type=NotificationType.CHAT_MENTION.value,
        notification_metadata={
            "channel_id": str(channel_id),
            "message_id": str(message_id),
        },
    )

    assert notification_action_path(delivery) == f"/chat/{channel_id}#{message_id}"


def test_task_email_uses_the_task_redirect_route() -> None:
    task_id = generate_id()

    assert notification_action_path(
        _delivery(content_type=ContentType.TASK, content_id=task_id)
    ) == f"/projects/task/{task_id}"


def test_preview_strips_mention_transport_and_header_whitespace() -> None:
    value = f"Hello\n[[[Alex|urn:uniffy:content:USER:{generate_id()}]]]\r\nthere"

    assert notification_preview(value) == "Hello Alex there"


def test_access_loss_email_does_not_link_to_revoked_content() -> None:
    delivery = _delivery(
        notification_type=NotificationType.PERMISSION_REVOKED,
        source_urn=None,
    )

    assert notification_action_path(delivery) == "/notifications"
