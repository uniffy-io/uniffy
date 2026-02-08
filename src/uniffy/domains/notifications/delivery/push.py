"""Web Push delivery adapter.

Sends browser push notifications via the Web Push protocol (VAPID).
Requires pywebpush and VAPID keys configured in environment variables.

This is a placeholder -- actual pywebpush integration is deferred to Phase 6.
"""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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
        return "push"

    async def deliver(
        self,
        user_id: UUID,
        event: NotificationEvent,
    ) -> bool:
        """
        Send push notification to all registered endpoints for a user.

        Parameters
        ----------
        user_id : UUID
            Recipient user ID.
        event : NotificationEvent
            The notification event.

        Returns
        -------
        bool
            True if at least one push was sent.

        """
        # Phase 6: full pywebpush integration
        logger.debug(
            f"Push delivery deferred: user={user_id} title={event.title}"
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

        Fetches push subscriptions, sends to each endpoint,
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
        result = await session.execute(
            select(PushSubscription).where(PushSubscription.user_id == user_id)
        )
        subscriptions = list(result.scalars().all())

        if not subscriptions:
            return False

        delivered = 0
        stale: list[PushSubscription] = []

        for sub in subscriptions:
            try:
                # Phase 6: replace with pywebpush.webpush() call
                # payload = json.dumps({
                #     "title": event.title,
                #     "body": event.body,
                #     "url": event.source_urn or "",
                # })
                # webpush(
                #     subscription_info={
                #         "endpoint": sub.endpoint,
                #         "keys": {
                #             "p256dh": sub.p256dh_key,
                #             "auth": sub.auth_key,
                #         },
                #     },
                #     data=payload,
                #     vapid_private_key=VAPID_PRIVATE_KEY,
                #     vapid_claims={"sub": f"mailto:{VAPID_EMAIL}"},
                # )
                logger.debug(
                    f"Would push to endpoint={sub.endpoint[:50]}... "
                    f"title={event.title}"
                )
                delivered += 1
                sub.last_used_at = datetime.now(UTC)
            except Exception as e:
                logger.warning(f"Push delivery failed for {sub.endpoint[:50]}: {e}")
                stale.append(sub)

        # Remove stale subscriptions (e.g., 410 Gone)
        for sub in stale:
            await session.delete(sub)

        return delivered > 0
