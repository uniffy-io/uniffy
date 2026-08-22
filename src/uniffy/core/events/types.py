"""Notification event types for the event bus."""

from dataclasses import dataclass, field
from uuid import UUID

from uniffy.core.types import ContentType, NotificationType, generate_id


@dataclass(frozen=True)
class NotificationEvent:
    """Event with explicit recipients or a content target for automatic resolution."""

    notification_type: NotificationType
    organization_id: UUID
    actor_id: UUID | None
    title: str
    body: str = ""
    source_urn: str | None = None
    target_user_ids: list[UUID] | None = None
    content_type: ContentType | None = None
    content_id: UUID | None = None
    metadata: dict | None = None
    event_id: UUID = field(default_factory=generate_id)
