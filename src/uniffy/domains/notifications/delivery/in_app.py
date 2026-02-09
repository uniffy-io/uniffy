"""In-app delivery adapter.

Handles two responsibilities:
1. Persist Notification record to PostgreSQL (so it shows in the panel).
2. Publish to Valkey Pub/Sub (so the streaming RPC pushes it in real time).
"""

from uuid import UUID

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.events.types import NotificationEvent
from uniffy.core.models.notifications.notification import Notification
from uniffy.core.valkey import publish_notification
from uniffy.domains.notifications.converters import notification_type_to_proto
from uniffy.domains.notifications.delivery.base import DeliveryAdapter


class InAppAdapter(DeliveryAdapter):
    """
    In-app notification delivery.

    Creates a DB record and publishes to Valkey Pub/Sub for
    real-time streaming to connected clients.
    """

    @property
    def channel_name(self) -> str:
        """Return channel identifier."""
        return "in_app"

    async def deliver(
        self,
        user_id: UUID,
        event: NotificationEvent,
    ) -> bool:
        """
        Persist notification and publish to real-time stream.

        Parameters
        ----------
        user_id : UUID
            Recipient user ID.
        event : NotificationEvent
            The notification event.

        Returns
        -------
        bool
            True if the notification was created and published.

        """
        # This adapter requires a session, injected per-batch by the worker
        # via deliver_with_session().
        logger.warning(
            "InAppAdapter.deliver() called without session; "
            "use deliver_with_session() instead"
        )
        return False

    async def deliver_with_session(
        self,
        session: AsyncSession,
        user_id: UUID,
        event: NotificationEvent,
    ) -> Notification:
        """
        Persist notification to DB.

        This variant accepts a session so multiple recipients can share
        a single transaction (batch commit). The returned Notification
        object will have its ID populated after session.commit().

        Parameters
        ----------
        session : AsyncSession
            Database session (caller manages commit).
        user_id : UUID
            Recipient user ID.
        event : NotificationEvent
            The notification event.

        Returns
        -------
        Notification
            The created notification (ID available after commit).

        """
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
        """
        Publish notification to Valkey Pub/Sub for real-time delivery.

        Must be called after session.commit() so notification.id is set.

        Parameters
        ----------
        notification : Notification
            The persisted notification (with DB-generated ID).
        actor_name : str
            Display name of the actor who triggered the notification.

        """
        payload = {
            "id": str(notification.id),
            "organization_id": str(notification.organization_id),
            "user_id": str(notification.user_id),
            "notification_type": notification_type_to_proto(
                notification.notification_type
            ),
            "title": notification.title,
            "body": notification.body or "",
            "source_urn": notification.source_urn or "",
            "actor_id": str(notification.actor_id) if notification.actor_id else "",
            "actor_name": actor_name,
            "is_read": False,
            "created_at": notification.created_at.isoformat(),
        }
        await publish_notification(notification.user_id, payload)
