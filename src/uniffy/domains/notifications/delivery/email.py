"""Email delivery adapter.

Sends notification emails via SMTP. Supports both instant delivery
and digest aggregation (hourly/daily).

This is a placeholder -- actual SMTP integration is deferred to Phase 6.
"""

from uuid import UUID

from loguru import logger

from uniffy.core.events.types import NotificationEvent
from uniffy.domains.notifications.delivery.base import DeliveryAdapter


class EmailAdapter(DeliveryAdapter):
    """
    Email notification delivery via SMTP.

    For users with email_frequency="instant", sends immediately.
    For "hourly" or "daily" users, notifications are aggregated
    by the send_email_digest cron job instead.
    """

    @property
    def channel_name(self) -> str:
        """Return channel identifier."""
        return "email"

    async def deliver(
        self,
        user_id: UUID,
        event: NotificationEvent,
    ) -> bool:
        """
        Send an email notification to a user.

        Parameters
        ----------
        user_id : UUID
            Recipient user ID.
        event : NotificationEvent
            The notification event.

        Returns
        -------
        bool
            True if the email was sent (or queued for digest).

        """
        # Phase 6: full SMTP integration
        # 1. Look up user email and email_frequency preference
        # 2. If frequency == "instant":
        #      - Render HTML template with event data
        #      - Send via aiosmtplib
        # 3. If frequency == "hourly" or "daily":
        #      - Skip (the send_email_digest cron aggregates these)
        #      - Return True to indicate "handled"
        logger.debug(
            f"Email delivery deferred: user={user_id} title={event.title}"
        )
        return False
