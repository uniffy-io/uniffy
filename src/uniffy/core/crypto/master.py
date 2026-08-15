"""Master Key Encryption Key (KEK) for the deployment.

A single Fernet on ``APP_MASTER_KEY`` wraps every per-org and deployment DEK.
The cipher is cached for the process lifetime.
"""

from __future__ import annotations

import functools
import os

from cryptography.fernet import Fernet

from uniffy.core.crypto.errors import MasterKeyMissingError


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
        raise MasterKeyMissingError(f"APP_MASTER_KEY is not a valid Fernet key: {exc}") from exc


def reset_master_cipher_cache() -> None:
    """Test-only: drop the cached master cipher between cases."""
    get_master_cipher.cache_clear()
