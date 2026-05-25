"""Typed errors for the invitations domain."""

from uniffy.core.errors import UNIFFYError


class InvitationError(UNIFFYError):
    """Base class for invitation-domain errors."""


class InvitationNotFoundError(InvitationError):
    """Token does not match any invitation row."""


class InvitationExpiredError(InvitationError):
    """Invitation passed its ``expires_at``."""


class InvitationAlreadyUsedError(InvitationError):
    """Invitation already accepted; tokens are single-use."""


class InvitationRevokedError(InvitationError):
    """Invitation was revoked by an admin."""


class InvitationEmailConflictError(InvitationError):
    """Email is already bound to an active user (race between invite + register)."""
