"""Notification delivery adapters.

Each adapter handles a single delivery channel. The worker resolves
which channels are enabled per recipient and delegates to the
appropriate adapters.

To add a new channel:
1. Subclass DeliveryAdapter in a new file
2. Register it in DELIVERY_ADAPTERS below
3. Add the channel key to DEFAULT_NOTIFICATION_CHANNELS in settings defaults
"""

from uniffy.domains.notifications.delivery.base import DeliveryAdapter
from uniffy.domains.notifications.delivery.email import EmailAdapter
from uniffy.domains.notifications.delivery.in_app import InAppAdapter
from uniffy.domains.notifications.delivery.push import PushAdapter

# Registry: channel_name -> adapter instance
# The worker looks up adapters by the channel names returned from
# _get_delivery_channels() (e.g., {"in_app", "push", "email"}).
DELIVERY_ADAPTERS: dict[str, DeliveryAdapter] = {
    "in_app": InAppAdapter(),
    "push": PushAdapter(),
    "email": EmailAdapter(),
}

__all__ = [
    "DeliveryAdapter",
    "InAppAdapter",
    "PushAdapter",
    "EmailAdapter",
    "DELIVERY_ADAPTERS",
]
