"""SMTP delivery seam.

``build_backend`` is the single construction point used by
``MailSender``. The seam exists so future Postmark/SES backends can plug
in without changing the sender.
"""

from uniffy.core.mail.backends.base import MailBackend, MailResult
from uniffy.core.mail.backends.smtp import SmtpBackend
from uniffy.core.mail.config import MailConfig


def build_backend(config: MailConfig) -> MailBackend:
    """Return the backend implementation for ``config``."""
    return SmtpBackend(config)


__all__ = ["MailBackend", "MailResult", "SmtpBackend", "build_backend"]
