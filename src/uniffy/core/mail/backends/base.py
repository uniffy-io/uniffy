"""Backend protocol + result type."""

from __future__ import annotations

from dataclasses import dataclass
from email.message import EmailMessage
from typing import Protocol


@dataclass(frozen=True)
class MailResult:
    success: bool
    provider_message_id: str | None = None
    error: str | None = None


class MailBackend(Protocol):
    async def send(
        self,
        message: EmailMessage,
        *,
        idempotency_key: str | None = None,
    ) -> MailResult: ...
