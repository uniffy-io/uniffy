"""Data Encryption Key generation + master-cipher wrapping.

A DEK is a Fernet-format key (32 random bytes, base64url-encoded so it
can be fed straight into ``Fernet(...)``). DEKs are wrapped with the
master cipher for storage; the plaintext form lives only in process
memory.
"""

from __future__ import annotations

import base64
import secrets

from cryptography.fernet import InvalidToken

from uniffy.core.crypto.errors import CryptoError
from uniffy.core.crypto.master import get_master_cipher


def generate_dek() -> bytes:
    """Return a fresh 44-byte Fernet-format Data Encryption Key.

    32 random bytes from ``secrets.token_bytes`` (CSPRNG-backed) wrapped
    in url-safe base64 padding so the result can be passed directly to
    ``Fernet(...)``.
    """
    return base64.urlsafe_b64encode(secrets.token_bytes(32))


def wrap_dek(dek: bytes) -> str:
    """Encrypt a DEK with the master cipher and return the Fernet token."""
    return get_master_cipher().encrypt(dek).decode("ascii")


def unwrap_dek(wrapped: str) -> bytes:
    """Decrypt a wrapped DEK and return the raw Fernet-format key.

    Raises ``CryptoError`` on tamper / wrong master key. The wrapped
    ``InvalidToken`` is hidden so callers depend on the package's error
    hierarchy only.
    """
    try:
        return get_master_cipher().decrypt(wrapped.encode("ascii"))
    except InvalidToken as exc:
        raise CryptoError(
            "Failed to unwrap DEK; master key mismatch or DEK ciphertext corrupted"
        ) from exc
