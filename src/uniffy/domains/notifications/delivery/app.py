"""In-app delivery: persist to PG and publish to Valkey Pub/Sub for streaming."""

from uuid import UUID

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.events.types import NotificationEvent
from uniffy.core.models.notifications.notification import Notification
from uniffy.core.valkey import publish_notification
from uniffy.domains.notifications.converters import notification_type_to_proto
from uniffy.domains.notifications.delivery.base import DeliveryAdapter, NotificationChannel

logger = logger.bind(component="notifications.delivery.app")


class InAppAdapter(DeliveryAdapter):
    """In-app delivery: writes a DB row and publishes for real-time streaming."""

    @property
    def channel_name(self) -> NotificationChannel:
        return NotificationChannel.IN_APP

    async def deliver(
        self,
        user_id: UUID,
        event: NotificationEvent,
    ) -> bool:
        # Real path is ``deliver_with_session`` so multiple recipients share a tx.
        logger.warning(
            "InAppAdapter.deliver() called without session; use deliver_with_session() instead"
        )
        return False

    async def deliver_with_session(
        self,
        session: AsyncSession,
        user_id: UUID,
        event: NotificationEvent,
    ) -> Notification:
        """Stage a ``Notification`` row on ``session``; ID is set after commit."""
        notification = Notification(
            organization_id=event.organization_id,
            user_id=user_id,
            notification_type=event.notification_type,
            title=event.title,
            body=event.body,
            source_urn=event.source_urn,
            actor_id=event.actor_id,
            notification_metadata=event.metadata,
        )
        session.add(notification)
        return notification

    async def publish_realtime(
        self,
        notification: Notification,
        actor_name: str = "",
    ) -> None:
        """Publish to Valkey Pub/Sub - call after commit so ``notification.id`` is set."""
        payload = {
            "id": str(notification.id),
            "organization_id": str(notification.organization_id),
            "user_id": str(notification.user_id),
            "notification_type": notification_type_to_proto(notification.notification_type),
            "title": notification.title,
            "body": notification.body or "",
            "source_urn": notification.source_urn or "",
            "actor_id": str(notification.actor_id) if notification.actor_id else "",
            "actor_name": actor_name,
            "is_read": False,
            "created_at": notification.created_at.isoformat(),
            "metadata": {
                k: str(v)
                for k, v in (notification.notification_metadata or {}).items()
                if v is not None
            },
        }
        await publish_notification(notification.user_id, payload)
