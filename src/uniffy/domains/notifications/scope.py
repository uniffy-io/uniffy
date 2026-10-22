"""Bind the notification stream to the one organization its client serves."""

from typing import Any
from uuid import UUID

from uniffy.core.events.realtime import NotificationPayloadType
from uniffy.domains.tags.events import (
    EVENT_TAG_ASSIGNMENT_CHANGED,
    EVENT_TAG_CREATED,
    EVENT_TAG_DELETED,
    EVENT_TAG_UPDATED,
)

# These ride channels named after one organization, so the subscription already scopes them.
_ORGANIZATION_CHANNEL_TYPES = frozenset({
    NotificationPayloadType.CONTENT_CHANGED,
    NotificationPayloadType.PRESENCE_CHANGED,
    NotificationPayloadType.MENTION_STATE_CHANGED,
    EVENT_TAG_CREATED,
    EVENT_TAG_UPDATED,
    EVENT_TAG_DELETED,
    EVENT_TAG_ASSIGNMENT_CHANGED,
})


class NotificationOrganizationFilter:
    """Admits payloads of the stream organization; `notifications:{user_id}` carries every org.

    `publish_notification` stamps each payload with its organization, so one without it is dropped.
    """

    def __init__(self, organization_id: UUID) -> None:
        self._organization_id = str(organization_id)

    def admits(self, payload: dict[str, Any]) -> bool:
        if payload.get("_type") in _ORGANIZATION_CHANNEL_TYPES:
            return True
        return payload.get("organization_id") == self._organization_id
