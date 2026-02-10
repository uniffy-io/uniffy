"""Web Push delivery adapter.

Sends browser push notifications via the Web Push protocol (VAPID).
Requires pywebpush and VAPID keys configured in environment variables.
"""

import json
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from pywebpush import WebPushException, webpush
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.config.push import get_vapid_config
from uniffy.core.events.types import NotificationEvent
from uniffy.core.models.notifications.push_subscription import PushSubscription
from uniffy.domains.notifications.delivery.base import DeliveryAdapter


class PushAdapter(DeliveryAdapter):
    """
    Web Push notification delivery via VAPID.

    Queries the user's PushSubscription records and sends a push
    payload to each registered browser/device endpoint.
    Stale subscriptions (410 Gone) are automatically removed.
    """

    @property
    def channel_name(self) -> str:
        """Return channel identifier."""
        return "browser"

    async def deliver(
        self,
        user_id: UUID,
        event: NotificationEvent,
    ) -> bool:
        """
        Send push notification to all registered endpoints for a user.

        This variant has no DB session, so it cannot query subscriptions.
        The worker always uses deliver_with_session() instead.

        Parameters
        ----------
        user_id : UUID
            Recipient user ID.
        event : NotificationEvent
            The notification event.

        Returns
        -------
        bool
            Always False -- use deliver_with_session() for actual delivery.

        """
        logger.debug(
            f"Push deliver() called without session: user={user_id} title={event.title}"
        )
        return False

    async def deliver_with_session(
        self,
        session: AsyncSession,
        user_id: UUID,
        event: NotificationEvent,
    ) -> bool:
        """
        Send push notification using a shared DB session.

        Fetches push subscriptions, sends to each endpoint via pywebpush,
        and cleans up stale subscriptions.

        Parameters
        ----------
        session : AsyncSession
            Database session for subscription queries.
        user_id : UUID
            Recipient user ID.
        event : NotificationEvent
            The notification event.

        Returns
        -------
        bool
            True if at least one push was sent.

        """
        vapid_config = get_vapid_config()
        if not vapid_config:
            logger.debug("Push skipped: VAPID not configured")
            return False

        result = await session.execute(
            select(PushSubscription).where(PushSubscription.user_id == user_id)
        )
        subscriptions = list(result.scalars().all())

        if not subscriptions:
            logger.debug(f"Push skipped: no subscriptions for user {user_id}")
            return False

        payload = json.dumps({
            "title": event.title,
            "body": event.body or "",
            "url": event.source_urn or "",
            "notification_type": event.notification_type.value
            if hasattr(event.notification_type, "value")
            else str(event.notification_type),
        })

        delivered = 0
        stale: list[PushSubscription] = []

        for sub in subscriptions:
            try:
                webpush(
                    subscription_info={
                        "endpoint": sub.endpoint,
                        "keys": {
                            "p256dh": sub.p256dh_key,
                            "auth": sub.auth_key,
                        },
                    },
                    data=payload,
                    vapid_private_key=vapid_config.private_key,
                    vapid_claims={"sub": vapid_config.contact_email},
                )
                delivered += 1
                sub.last_used_at = datetime.now(UTC)
            except WebPushException as e:
                if e.response and e.response.status_code == 410:
                    logger.info(
                        f"Push subscription expired (410), removing: {sub.endpoint[:60]}"
                    )
                    stale.append(sub)
                else:
                    status = e.response.status_code if e.response else "N/A"
                    logger.warning(
                        f"Push delivery failed for {sub.endpoint[:60]}: "
                        f"status={status} {e}"
                    )
            except Exception as e:
                logger.warning(f"Push delivery error for {sub.endpoint[:60]}: {e}")

        # Remove stale subscriptions (e.g., 410 Gone)
        for sub in stale:
            await session.delete(sub)

        return delivered > 0
