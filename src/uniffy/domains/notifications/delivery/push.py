"""Web Push (VAPID) delivery adapter."""

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

logger = logger.bind(component="notifications.delivery.push")


class PushAdapter(DeliveryAdapter):
    """Web Push delivery via VAPID; 410 endpoints are pruned on send."""

    @property
    def channel_name(self) -> str:
        return "browser"

    async def deliver(
        self,
        user_id: UUID,
        event: NotificationEvent,
    ) -> bool:
        # No DB session - real path is ``deliver_with_session``.
        logger.debug(f"Push deliver() called without session: user={user_id} title={event.title}")
        return False

    async def deliver_with_session(
        self,
        session: AsyncSession,
        user_id: UUID,
        event: NotificationEvent,
    ) -> bool:
        """Send push to every registered endpoint and prune stale (410) rows."""
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
                    logger.info(f"Push subscription expired (410), removing: {sub.endpoint[:60]}")
                    stale.append(sub)
                else:
                    status = e.response.status_code if e.response else "N/A"
                    logger.warning(
                        f"Push delivery failed for {sub.endpoint[:60]}: status={status} {e}"
                    )
            except Exception as e:
                logger.warning(f"Push delivery error for {sub.endpoint[:60]}: {e}")

        for sub in stale:
            await session.delete(sub)

        return delivered > 0
