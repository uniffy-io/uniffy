"""Custom error types for auth domain."""

from uwos.core.errors import UWOSError


class AuthenticationError(UWOSError):
    """Exception raised for authentication failures."""

    pass


class RegistrationError(UWOSError):
    """Exception raised for registration failures."""

    pass


class TokenError(UWOSError):
    """Exception raised for token-related errors."""

    pass


class OrganizationAccessError(UWOSError):
    """Exception raised when user cannot access organization."""

    pass
