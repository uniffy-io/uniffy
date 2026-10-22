"""Application event vocabulary and realtime channel routing."""

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from uniffy.core.converters.common_proto import CONTENT_TYPE_TO_PROTO
from uniffy.core.types import ContentType
from uniffy.infrastructure.valkey.pubsub import publish_to_channel


class NotificationPayloadType(StrEnum):
    CONTENT_CHANGED = "content_changed"
    FILE_UPDATED = "file_updated"
    PRESENCE_CHANGED = "presence_changed"
    PERMISSIONS_CHANGED = "permissions_changed"
    CONTENT_ACCESS_CHANGED = "content_access_changed"
    MENTION_STATE_CHANGED = "mention_state_changed"
    ACCESS_REQUEST_CHANGED = "access_request_changed"


class ContentAccessAction(StrEnum):
    GRANTED = "granted"
    REVOKED = "revoked"
    ACCESS_MODE_CHANGED = "access_mode_changed"
    CHILD_ADDED = "child_added"
    VIEWS_CHANGED = "views_changed"


def notification_channel(user_id: UUID) -> str:
    return f"notifications:{user_id}"


async def publish_notification(
    user_id: UUID, payload: dict[str, Any], *, organization_id: UUID
) -> None:
    """`notifications:{user_id}` carries every organization; the stamp lets a stream keep its own."""
    await publish_to_channel(
        notification_channel(user_id),
        {**payload, "organization_id": str(organization_id)},
    )


async def publish_content_access_changed(
    *,
    content_type: int,
    content_id: UUID,
    action: ContentAccessAction,
    organization_id: UUID,
    target_user_ids: list[UUID] | None = None,
) -> None:
    payload = {
        "_type": NotificationPayloadType.CONTENT_ACCESS_CHANGED,
        "content_type": content_type,
        "content_id": str(content_id),
        "action": action,
        "organization_id": str(organization_id),
    }
    if target_user_ids is None:
        await publish_to_channel(f"content:{organization_id}", payload)
        return
    for user_id in target_user_ids:
        await publish_notification(user_id, payload, organization_id=organization_id)


async def publish_access_request_changed(
    *,
    user_id: UUID,
    organization_id: UUID,
    request_id: UUID,
    requested_urn: str,
    state: int,
    can_request_again_at: datetime | None = None,
) -> None:
    payload: dict[str, Any] = {
        "_type": NotificationPayloadType.ACCESS_REQUEST_CHANGED,
        "request_id": str(request_id),
        "requested_urn": requested_urn,
        "state": state,
    }
    if can_request_again_at is not None:
        payload["can_request_again_at"] = can_request_again_at.isoformat()
    await publish_notification(user_id, payload, organization_id=organization_id)


async def publish_content_changed(
    content_type: ContentType, content_id: UUID, organization_id: UUID
) -> None:
    await publish_to_channel(
        f"content:{organization_id}",
        {
            "_type": NotificationPayloadType.CONTENT_CHANGED,
            "content_type": int(CONTENT_TYPE_TO_PROTO[content_type]),
            "content_id": str(content_id),
        },
    )
