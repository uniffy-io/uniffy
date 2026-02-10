"""Fernet encryption utilities for application settings.

Uses the existing JWT_SECRET_KEY to derive a Fernet key via SHA-256,
so no additional secret management is required.
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken


def _derive_fernet_key(secret: str) -> bytes:
    """Derive a 32-byte Fernet key from an arbitrary secret string.

    Fernet requires a 32-byte base64url-encoded key. We use SHA-256
    to produce a deterministic 32-byte digest, then base64url-encode it.

    Parameters
    ----------
    secret : str
        The secret string (typically JWT_SECRET_KEY).

    Returns
    -------
    bytes
        A 44-byte base64url-encoded key suitable for Fernet.

    """
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def _get_fernet() -> Fernet:
    """Return a Fernet instance keyed from JWT_SECRET_KEY.

    Lazy-imports ``get_secret_key`` to avoid circular imports
    (this module is used by models/seed, which import before auth).

    Returns
    -------
    Fernet
        Configured Fernet cipher.

    """
    from uniffy.domains.auth.tokens import get_secret_key

    return Fernet(_derive_fernet_key(get_secret_key()))


def encrypt_value(plaintext: str) -> str:
    """Encrypt a plaintext string and return the Fernet token as a string.

    Parameters
    ----------
    plaintext : str
        The value to encrypt.

    Returns
    -------
    str
        Base64-encoded Fernet token.

    """
    return _get_fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_value(ciphertext: str) -> str:
    """Decrypt a Fernet token back to plaintext.

    Parameters
    ----------
    ciphertext : str
        Base64-encoded Fernet token produced by ``encrypt_value``.

    Returns
    -------
    str
        Original plaintext.

    Raises
    ------
    ValueError
        If decryption fails (e.g. JWT_SECRET_KEY changed since encryption).

    """
    try:
        return _get_fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        msg = (
            "Failed to decrypt application setting. "
            "This usually means JWT_SECRET_KEY has changed since the value was encrypted. "
            "Re-seed or manually update the encrypted settings."
        )
        raise ValueError(msg) from exc
