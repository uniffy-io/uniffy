"""Notification delivery adapters keyed by channel name."""

from uniffy.domains.notifications.delivery.base import DeliveryAdapter
from uniffy.domains.notifications.delivery.email import EmailAdapter
from uniffy.domains.notifications.delivery.in_app import InAppAdapter
from uniffy.domains.notifications.delivery.push import PushAdapter

DELIVERY_ADAPTERS: dict[str, DeliveryAdapter] = {
    "in_app": InAppAdapter(),
    "browser": PushAdapter(),
    "email": EmailAdapter(),
}

__all__ = [
    "DeliveryAdapter",
    "InAppAdapter",
    "PushAdapter",
    "EmailAdapter",
    "DELIVERY_ADAPTERS",
]
