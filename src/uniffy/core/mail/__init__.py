"""Provider-agnostic SMTP mail with per-org config, suppression, and rate limiting."""

from uniffy.core.mail.backends.base import MailBackend, MailResult
from uniffy.core.mail.config import MailConfig
from uniffy.core.mail.errors import (
    MailError,
    MailNotConfiguredError,
    MailProviderError,
    MailRateLimitedError,
    MailSuppressedError,
    TemplateNotFoundError,
)
from uniffy.core.mail.rendering import RenderedMail, render_template
from uniffy.core.mail.resolver import MailConfigResolver
from uniffy.core.mail.sender import MailSender
from uniffy.core.mail.suppression import SuppressionRepository

__all__ = [
    "MailBackend",
    "MailConfig",
    "MailConfigResolver",
    "MailError",
    "MailNotConfiguredError",
    "MailProviderError",
    "MailRateLimitedError",
    "MailResult",
    "MailSender",
    "MailSuppressedError",
    "RenderedMail",
    "SuppressionRepository",
    "TemplateNotFoundError",
    "render_template",
]
