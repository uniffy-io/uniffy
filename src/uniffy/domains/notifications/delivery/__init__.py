"""Notification delivery adapters keyed by channel name."""

from uniffy.core.database import SessionFactory
from uniffy.domains.notifications.delivery.app import InAppAdapter
from uniffy.domains.notifications.delivery.base import DeliveryAdapter, NotificationChannel
from uniffy.domains.notifications.delivery.email import EmailAdapter
from uniffy.domains.notifications.delivery.push import PushAdapter

DELIVERY_ADAPTERS_CTX_KEY = "notification_delivery_adapters"
type DeliveryAdapters = dict[NotificationChannel, DeliveryAdapter]


def build_delivery_adapters(session_factory: SessionFactory) -> DeliveryAdapters:
    return {
        NotificationChannel.IN_APP: InAppAdapter(),
        NotificationChannel.BROWSER: PushAdapter(),
        NotificationChannel.EMAIL: EmailAdapter(session_factory),
    }


__all__ = [
    "DeliveryAdapter",
    "InAppAdapter",
    "NotificationChannel",
    "PushAdapter",
    "EmailAdapter",
    "DELIVERY_ADAPTERS_CTX_KEY",
    "DeliveryAdapters",
    "build_delivery_adapters",
]
