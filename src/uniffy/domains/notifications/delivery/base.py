"""Base delivery adapter for notification channels."""

from abc import ABC, abstractmethod
from enum import StrEnum
from uuid import UUID

from uniffy.core.events.types import NotificationEvent


class NotificationChannel(StrEnum):
    IN_APP = "in_app"
    BROWSER = "browser"
    EMAIL = "email"


class DeliveryAdapter(ABC):
    """Abstract delivery channel; one subclass per channel (in_app, browser, email)."""

    @property
    @abstractmethod
    def channel_name(self) -> NotificationChannel:
        """Channel key matching ``DEFAULT_NOTIFICATION_CHANNELS`` / ``channel_overrides``."""

    @abstractmethod
    async def deliver(
        self,
        user_id: UUID,
        event: NotificationEvent,
    ) -> bool:
        """Deliver ``event`` to ``user_id``; returns True on success."""

    async def startup(self) -> None:
        return  # noqa: B027 -- intentionally optional

    async def shutdown(self) -> None:
        return  # noqa: B027 -- intentionally optional
