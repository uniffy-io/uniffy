"""Fire-and-forget notification event bus over ARQ; never raises on a missing queue."""

import json
from typing import Any

from loguru import logger

from uniffy.core.events.types import NotificationEvent
from uniffy.core.valkey import get_queue

logger = logger.bind(component="events.bus")


def _event_to_json(event: NotificationEvent) -> str:
    data: dict[str, Any] = {
        "notification_type": event.notification_type.value,
        "organization_id": str(event.organization_id),
        "actor_id": str(event.actor_id),
        "title": event.title,
        "body": event.body,
    }

    if event.source_urn is not None:
        data["source_urn"] = event.source_urn
    if event.target_user_ids is not None:
        data["target_user_ids"] = [str(uid) for uid in event.target_user_ids]
    if event.content_type is not None:
        data["content_type"] = event.content_type.value
    if event.content_id is not None:
        data["content_id"] = str(event.content_id)
    if event.metadata is not None:
        data["metadata"] = event.metadata

    return json.dumps(data)


def event_from_json(json_str: str) -> NotificationEvent:
    from uuid import UUID

    from uniffy.core.types import ContentType, NotificationType

    data = json.loads(json_str)

    target_user_ids = None
    if "target_user_ids" in data:
        target_user_ids = [UUID(uid) for uid in data["target_user_ids"]]

    content_type = None
    if "content_type" in data:
        content_type = ContentType(data["content_type"])

    content_id = None
    if "content_id" in data:
        content_id = UUID(data["content_id"])

    return NotificationEvent(
        notification_type=NotificationType(data["notification_type"]),
        organization_id=UUID(data["organization_id"]),
        actor_id=UUID(data["actor_id"]),
        title=data["title"],
        body=data.get("body", ""),
        source_urn=data.get("source_urn"),
        target_user_ids=target_user_ids,
        content_type=content_type,
        content_id=content_id,
        metadata=data.get("metadata"),
    )


async def emit_notification(event: NotificationEvent) -> None:
    """Enqueue an ARQ job; never raises."""
    try:
        queue = get_queue("core")
        event_json = _event_to_json(event)
        await queue.enqueue_job("process_notification_event", event_json)
    except RuntimeError:
        logger.warning("Notification queue unavailable, skipping event")
    except Exception:
        logger.opt(exception=True).warning("Failed to enqueue notification event")
