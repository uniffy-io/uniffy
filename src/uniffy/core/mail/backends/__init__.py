"""Backend construction seam for ``MailSender``."""

from uniffy.core.mail.backends.base import MailBackend, MailResult
from uniffy.core.mail.backends.smtp import SmtpBackend
from uniffy.core.mail.config import MailConfig


def build_backend(config: MailConfig) -> MailBackend:
    return SmtpBackend(config)


__all__ = ["MailBackend", "MailResult", "SmtpBackend", "build_backend"]
