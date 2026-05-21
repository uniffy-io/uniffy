"""Master Key Encryption Key (KEK) for the deployment.

The master cipher is a single Fernet keyed on ``APP_MASTER_KEY``. It
wraps every per-organization Data Encryption Key in
``org_encryption_keys`` and encrypts app-wide secrets that have no org
scope (VAPID private key, future webhook signing secrets).

The Fernet instance is cached for the process lifetime -- the key never
changes during a run, and Fernet itself is cheap to call once
constructed. Tests can clear the cache via ``reset_master_cipher_cache``
to test misconfiguration paths.
"""

from __future__ import annotations

import functools
import os

from cryptography.fernet import Fernet, InvalidToken

from uniffy.core.crypto.errors import CryptoError, MasterKeyMissingError


@functools.lru_cache(maxsize=1)
def get_master_cipher() -> Fernet:
    """Return the process-wide Fernet keyed on ``APP_MASTER_KEY``.

    Raises ``MasterKeyMissingError`` if the env var is unset or fails
    Fernet's key-format validation. The error is fatal: every encrypted
    column in the deployment depends on this cipher.
    """
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
    """Drop the cached master cipher.

    Test-only helper: every prod read goes through ``get_master_cipher``
    which keeps the instance for the process lifetime. Tests that mutate
    ``APP_MASTER_KEY`` call this between cases.
    """
    get_master_cipher.cache_clear()


def app_encrypt(plaintext: str) -> str:
    """Encrypt an app-wide (non-org-scoped) secret with the master cipher.

    For org-scoped secrets use ``OrgCipher.encrypt(org_id, plaintext)``
    instead -- this helper exists only for genuinely deployment-wide
    values like the VAPID private key.
    """
    return get_master_cipher().encrypt(plaintext.encode("utf-8")).decode("ascii")


def app_decrypt(ciphertext: str) -> str:
    """Reverse of ``app_encrypt``.

    Raises ``CryptoError`` on tamper / wrong key. The wrapped
    ``InvalidToken`` is suppressed so callers depend on the package's
    error hierarchy only.
    """
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
