"""Notification event types for the event bus."""

from dataclasses import dataclass
from uuid import UUID

from uniffy.core.types import ContentType, NotificationType


@dataclass(frozen=True)
class NotificationEvent:
    """
    Event emitted by domain operations to trigger notifications.

    Either target_user_ids (explicit recipients) or content_type + content_id
    (for automatic recipient resolution) should be provided.

    Attributes
    ----------
    notification_type : NotificationType
        Type of notification to create.
    organization_id : UUID
        Organization context.
    actor_id : UUID
        User who triggered the event.
    title : str
        Short notification title.
    body : str
        Notification body (Markdown with URN mentions).
    source_urn : str | None
        URN of the related content.
    target_user_ids : list[UUID] | None
        Explicit list of recipient user IDs.
    content_type : ContentType | None
        Content type for automatic recipient resolution.
    content_id : UUID | None
        Content ID for automatic recipient resolution.
    metadata : dict | None
        Additional metadata for delivery adapters.

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
