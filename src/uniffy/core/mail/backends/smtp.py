"""SMTP delivery backed by ``aiosmtplib``.

Stateless: one TCP connection per send. Cheap enough at v1 throughput
and avoids a long-lived connection that an MTA might idle out between
sends. Port 587 negotiates STARTTLS; port 465 uses implicit TLS. Other
ports fall through with TLS disabled.
"""

from __future__ import annotations

from email.message import EmailMessage

import aiosmtplib
from loguru import logger

from uniffy.core.mail.backends.base import MailBackend, MailResult
from uniffy.core.mail.config import MailConfig


class SmtpBackend(MailBackend):
    """One-shot SMTP submission client."""

    def __init__(self, config: MailConfig) -> None:
        self._config = config

    async def send(
        self,
        message: EmailMessage,
        *,
        idempotency_key: str | None = None,
    ) -> MailResult:
        """Submit ``message`` to the SMTP server in ``self._config``.

        ``idempotency_key`` is currently informational only -- SMTP has
        no provider-side dedupe header. Callers that need at-most-once
        delivery layer dedupe on top via Valkey locks.
        """
        if idempotency_key:
            message["X-Idempotency-Key"] = idempotency_key

        host = self._config.smtp_host
        port = self._config.smtp_port
        use_tls = self._config.smtp_use_tls

        kwargs: dict[str, object] = {
            "hostname": host,
            "port": port,
            "username": self._config.smtp_username,
            "password": self._config.smtp_password,
            "timeout": 15,
        }
        if use_tls and port == 465:
            kwargs["use_tls"] = True
        elif use_tls:
            kwargs["start_tls"] = True

        try:
            errors, response = await aiosmtplib.send(message, **kwargs)
        except aiosmtplib.SMTPException as exc:
            logger.warning(
                "smtp send failed",
                component="mail",
                host=host,
                error=str(exc),
            )
            return MailResult(success=False, error=str(exc))

        if errors:
            error_str = "; ".join(f"{rcpt}: {err}" for rcpt, err in errors.items())
            return MailResult(success=False, error=error_str)
        return MailResult(success=True, provider_message_id=response or None)
