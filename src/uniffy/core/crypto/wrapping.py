"""DEK generation and master-cipher wrapping.

DEKs are Fernet-format keys (32 random bytes, url-safe base64) wrapped with
the master cipher for storage; plaintext lives only in process memory.
"""

from __future__ import annotations

import base64
import secrets

from cryptography.fernet import InvalidToken

from uniffy.core.crypto.errors import CryptoError
from uniffy.core.crypto.master import get_master_cipher


def generate_dek() -> bytes:
    """Fresh 44-byte Fernet-format DEK from a CSPRNG."""
    return base64.urlsafe_b64encode(secrets.token_bytes(32))


def wrap_dek(dek: bytes) -> str:
    return get_master_cipher().encrypt(dek).decode("ascii")


def unwrap_dek(wrapped: str) -> bytes:
    """Decrypt a wrapped DEK; raises ``CryptoError`` on tamper / wrong master key."""
    try:
        return get_master_cipher().decrypt(wrapped.encode("ascii"))
    except InvalidToken as exc:
        raise CryptoError(
            "Failed to unwrap DEK; master key mismatch or DEK ciphertext corrupted"
        ) from exc
