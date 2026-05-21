"""Error types raised by the crypto package."""

from uniffy.core.errors import UNIFFYError


class CryptoError(UNIFFYError):
    """Base for every crypto-package error.

    Use as the catch-all when downstream code wants to react to any
    encryption / decryption failure without caring about the specific
    cause.
    """


class MasterKeyMissingError(CryptoError):
    """Raised when ``APP_MASTER_KEY`` is unset or not a valid Fernet key.

    Fatal at startup: every encrypted secret in the deployment depends
    on the master cipher.
    """


class OrgDekNotFoundError(CryptoError):
    """Raised when an organization has no DEK row for a requested version.

    Almost always indicates a missing provisioning call (every org gets
    a ``v1`` DEK in ``OrganizationOperations.create``), a ciphertext
    referencing a version that was never written, or a DB-level row
    deletion.
    """


class OrgDekVersionMismatchError(CryptoError):
    """Raised when a ciphertext claims a DEK version that the org never had.

    Distinct from ``OrgDekNotFoundError`` so the caller can tell a
    corrupt / cross-tenant ciphertext apart from an unprovisioned org.
    """


class CiphertextFormatError(CryptoError):
    """Raised when ciphertext is missing the ``v{n}:`` version prefix or payload."""
