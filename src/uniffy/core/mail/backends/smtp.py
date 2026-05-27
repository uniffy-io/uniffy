"""SMTP delivery via ``aiosmtplib``.

One TCP connection per send. Port 587 negotiates STARTTLS, port 465 uses implicit
TLS, other ports fall through with TLS disabled.
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
        """Submit ``message`` to the configured SMTP server.
        ``idempotency_key`` is informational only.
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
