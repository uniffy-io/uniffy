"""Backend protocol + result type shared by every implementation."""

from __future__ import annotations

from dataclasses import dataclass
from email.message import EmailMessage
from typing import Protocol


@dataclass(frozen=True)
class MailResult:
    """Outcome of a single backend dispatch."""

    success: bool
    provider_message_id: str | None = None
    error: str | None = None


class MailBackend(Protocol):
    """Anything that can deliver one ``EmailMessage``."""

    async def send(
        self,
        message: EmailMessage,
        *,
        idempotency_key: str | None = None,
    ) -> MailResult:
        """Deliver ``message`` synchronously to the configured server."""
        ...
