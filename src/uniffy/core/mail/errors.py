"""Typed errors raised by the mail subsystem."""


class MailError(Exception):
    """Base class for every error raised by ``core/mail``."""

    def __init__(self, message: str, *, details: dict | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class MailNotConfiguredError(MailError):
    """No org row and no system env -- there is nothing to send through."""


class MailSuppressedError(MailError):
    """Recipient is on the global suppression list. Terminal in ARQ."""


class MailRateLimitedError(MailError):
    """Per-(org | system) rate limit exhausted for this window."""


class MailProviderError(MailError):
    """The SMTP backend failed to deliver. Caller decides retry vs terminal."""


class TemplateNotFoundError(MailError):
    """Requested template name is absent from the registry."""
