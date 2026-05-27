"""Notification event types for the event bus."""

from dataclasses import dataclass
from uuid import UUID

from uniffy.core.types import ContentType, NotificationType


@dataclass(frozen=True)
class NotificationEvent:
    """Notification event emitted by domain operations.

    Provide either ``target_user_ids`` (explicit recipients) or
    ``content_type`` + ``content_id`` (auto-resolved recipients).
    """

    notification_type: NotificationType
    organization_id: UUID
    actor_id: UUID
    title: str
    body: str = ""
    source_urn: str | None = None
    target_user_ids: list[UUID] | None = None
    content_type: ContentType | None = None
    content_id: UUID | None = None
    metadata: dict | None = None
