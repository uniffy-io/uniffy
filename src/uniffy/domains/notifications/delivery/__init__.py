"""Notification delivery adapters keyed by channel name."""

from uniffy.domains.notifications.delivery.app import InAppAdapter
from uniffy.domains.notifications.delivery.base import DeliveryAdapter, NotificationChannel
from uniffy.domains.notifications.delivery.email import EmailAdapter
from uniffy.domains.notifications.delivery.push import PushAdapter

DELIVERY_ADAPTERS: dict[NotificationChannel, DeliveryAdapter] = {
    NotificationChannel.IN_APP: InAppAdapter(),
    NotificationChannel.BROWSER: PushAdapter(),
    NotificationChannel.EMAIL: EmailAdapter(),
}

__all__ = [
    "DeliveryAdapter",
    "InAppAdapter",
    "NotificationChannel",
    "PushAdapter",
    "EmailAdapter",
    "DELIVERY_ADAPTERS",
]
