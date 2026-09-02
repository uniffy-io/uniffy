"""Safe notification email copy and application links."""

import os
import re
from uuid import UUID

from uniffy.core.content.references import parse_urn, strip_mentions_to_labels
from uniffy.core.models.notifications.email_delivery import NotificationEmailDelivery
from uniffy.core.types import ContentType, NotificationType

_CHAT_MESSAGE_TYPES = {
    NotificationType.CHAT_MENTION,
    NotificationType.CHAT_DM,
    NotificationType.CHAT_THREAD_REPLY,
}
_CONTENT_ROUTES = {
    ContentType.NOTE: "notes",
    ContentType.FILE: "files",
    ContentType.FOLDER: "files",
    ContentType.CALENDAR_EVENT: "calendar",
    ContentType.CHAT: "chat",
    ContentType.USER: "people",
    ContentType.TEAM: "people/teams",
    ContentType.PROJECT: "projects",
    ContentType.AGENT: "agents",
    ContentType.AGENT_CRON_TASK: "agents/automations",
    ContentType.AGENT_CHAT: "chat",
    ContentType.AGENT_FOLDER: "chat",
    ContentType.ROOM: "rooms",
    ContentType.TAG: "tags",
}
_WHITESPACE_RE = re.compile(r"\s+")

# Opens the channel's pre-join surface on arrival. Mail and browser push land from
# outside the app, so the join intent has to survive as a URL; the web client
# consumes this once and strips it.
JOIN_CALL_QUERY = "call=join"


def notification_action_url(delivery: NotificationEmailDelivery) -> str:
    return f"{uniffy_base_url()}{notification_action_path(delivery)}"


def notification_action_path(delivery: NotificationEmailDelivery) -> str:
    metadata = delivery.notification_metadata or {}
    try:
        notification_type = NotificationType(delivery.notification_type)
    except ValueError, TypeError:
        notification_type = None
    if notification_type in _CHAT_MESSAGE_TYPES:
        channel_id = metadata.get("channel_id")
        message_id = metadata.get("message_id")
        if channel_id:
            suffix = f"#{message_id}" if message_id else ""
            return f"/chat/{channel_id}{suffix}"

    if notification_type is NotificationType.CALENDAR_REMINDER:
        channel_id = metadata.get("channel_id")
        if channel_id:
            return f"/chat/{channel_id}?{JOIN_CALL_QUERY}"

    target = _delivery_content_target(delivery)
    if target is None:
        return "/notifications"
    content_type, content_id = target
    if content_type is ContentType.TASK:
        return f"/projects/task/{content_id}"
    if content_type is ContentType.CHAT_MESSAGE:
        channel_id = metadata.get("channel_id")
        return f"/chat/{channel_id}#{content_id}" if channel_id else "/notifications"
    route = _CONTENT_ROUTES.get(content_type)
    return f"/{route}/{content_id}" if route else "/notifications"


def notification_preferences_url() -> str:
    return f"{uniffy_base_url()}/settings?section=notifications"


def notifications_url() -> str:
    return f"{uniffy_base_url()}/notifications"


def notification_preview(value: str, *, limit: int = 500) -> str:
    plain = strip_mentions_to_labels(value or "")
    return _WHITESPACE_RE.sub(" ", plain).strip()[:limit]


def uniffy_base_url() -> str:
    return os.getenv("UNIFFY_BASE_URL", "http://localhost:5173").rstrip("/")


def _delivery_content_target(
    delivery: NotificationEmailDelivery,
) -> tuple[ContentType, UUID] | None:
    if delivery.content_type is not None and delivery.content_id is not None:
        try:
            return ContentType(delivery.content_type), delivery.content_id
        except ValueError, TypeError:
            return None
    if delivery.source_urn:
        return parse_urn(delivery.source_urn)
    return None
