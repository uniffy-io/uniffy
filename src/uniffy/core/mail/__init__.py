"""Email infrastructure: provider-agnostic SMTP sender with per-org config.

Every outbound mail flows through ``MailSender.send`` -- it resolves the
config for the caller's organization (per-org row in ``org_mail_configs``
or the system env default), renders the named template, checks the
global suppression list, applies a Valkey rate limit, and dispatches
through ``SmtpBackend`` (a single backend covers Resend, SES, Postmark
and self-hosted Postfix via SMTP submission).
"""

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
