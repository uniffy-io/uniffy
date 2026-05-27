"""Error types raised by the crypto package."""

from uniffy.core.errors import UNIFFYError


class CryptoError(UNIFFYError):
    """Base for every crypto-package error."""


class MasterKeyMissingError(CryptoError):
    """``APP_MASTER_KEY`` is unset or not a valid Fernet key; fatal at startup."""


class OrgDekNotFoundError(CryptoError):
    """Organization has no DEK row for the requested version."""


class OrgDekVersionMismatchError(CryptoError):
    """Ciphertext claims a DEK version the org never had (distinct from "not provisioned")."""


class CiphertextFormatError(CryptoError):
    """Ciphertext is missing the ``v{n}:`` version prefix or payload."""
