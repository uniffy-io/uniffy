"""Base delivery adapter for notification channels.

Each notification channel (in-app, push, email) implements this interface.
The worker iterates over enabled adapters per recipient, calling deliver().
"""

from abc import ABC, abstractmethod
from uuid import UUID

from uniffy.core.events.types import NotificationEvent


class DeliveryAdapter(ABC):
    """
    Abstract base class for notification delivery channels.

    Each subclass handles delivery to a single channel type
    (in_app, push, email, desktop). The worker resolves which
    channels are enabled per recipient and calls deliver() on each.
    """

    @property
    @abstractmethod
    def channel_name(self) -> str:
        """
        Channel identifier matching preference keys.

        Must match the keys used in DEFAULT_NOTIFICATION_CHANNELS
        and the channel_overrides settings: "in_app", "push", "email".
        """

    @abstractmethod
    async def deliver(
        self,
        user_id: UUID,
        event: NotificationEvent,
    ) -> bool:
        """
        Deliver a notification to a single recipient via this channel.

        Parameters
        ----------
        user_id : UUID
            Recipient user ID.
        event : NotificationEvent
            The notification event to deliver.

        Returns
        -------
        bool
            True if delivered successfully, False otherwise.

        """

    async def startup(self) -> None:
        """
        Optional lifecycle hook called when the worker starts.

        Override to initialize connections, load keys, etc.
        """
        return  # noqa: B027 -- intentionally optional

    async def shutdown(self) -> None:
        """
        Optional lifecycle hook called when the worker stops.

        Override to close connections and release resources.
        """
        return  # noqa: B027 -- intentionally optional
