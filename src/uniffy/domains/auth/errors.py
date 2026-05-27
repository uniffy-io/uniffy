"""Custom error types for auth domain."""

from uniffy.core.errors import UNIFFYError


class AuthenticationError(UNIFFYError):
    """Exception raised for authentication failures."""

    pass


class RegistrationError(UNIFFYError):
    """Exception raised for registration failures."""

    pass


class TokenError(UNIFFYError):
    """Exception raised for token-related errors."""

    pass


class OrganizationAccessError(UNIFFYError):
    """Exception raised when user cannot access organization."""

    pass


class MfaRateLimitedError(UNIFFYError):
    """Raised when MFA verify attempts exceed the per-user / per-IP cap."""

    pass
