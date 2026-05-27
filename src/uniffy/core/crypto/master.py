"""Master Key Encryption Key (KEK) for the deployment.

A single Fernet on ``APP_MASTER_KEY`` wraps every per-org DEK and encrypts
app-wide secrets (e.g. VAPID). The cipher is cached for the process lifetime.
"""

from __future__ import annotations

import functools
import os

from cryptography.fernet import Fernet, InvalidToken

from uniffy.core.crypto.errors import CryptoError, MasterKeyMissingError


@functools.lru_cache(maxsize=1)
def get_master_cipher() -> Fernet:
    """Process-wide Fernet on ``APP_MASTER_KEY``; missing / invalid is fatal."""
    raw = os.environ.get("APP_MASTER_KEY", "").strip()
    if not raw:
        raise MasterKeyMissingError(
            "APP_MASTER_KEY env var is not set; cannot initialise master cipher"
        )
    try:
        return Fernet(raw.encode("ascii"))
    except (ValueError, TypeError) as exc:
        raise MasterKeyMissingError(
            f"APP_MASTER_KEY is not a valid Fernet key: {exc}"
        ) from exc


def reset_master_cipher_cache() -> None:
    """Test-only: drop the cached master cipher between cases."""
    get_master_cipher.cache_clear()


def app_encrypt(plaintext: str) -> str:
    """Encrypt an app-wide (non-org-scoped) secret; use ``OrgCipher`` for org-scoped values."""
    return get_master_cipher().encrypt(plaintext.encode("utf-8")).decode("ascii")


def app_decrypt(ciphertext: str) -> str:
    """Reverse of ``app_encrypt``; raises ``CryptoError`` on tamper / wrong key."""
    try:
        return (
            get_master_cipher()
            .decrypt(ciphertext.encode("ascii"))
            .decode("utf-8")
        )
    except InvalidToken as exc:
        raise CryptoError(
            "Failed to decrypt app-wide secret; master key mismatch or ciphertext corrupted"
        ) from exc
