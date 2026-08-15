"""TOTP secret encryption + DEK-rotation consumer.

The raw TOTP secret is 20 random bytes (per RFC 6238 §5.1). We base32-
encode it (the same encoding the authenticator app consumes from the
provisioning URI) and wrap it through :class:`DeploymentCipher`. Storing
the base32 form rather than raw bytes keeps the wire shape consistent
with the rest of the deployment-scope ciphertext, and lets us re-hand
the plaintext straight to ``pyotp`` without a re-encode step.

A :class:`DeploymentReEncryptingConsumer` is registered at import time
for ``login_user_mfa.totp_secret_encrypted`` so the deployment-DEK
rotation worker re-encrypts the column with no further wiring.
"""

from __future__ import annotations

import base64
import os
from collections.abc import AsyncIterator

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.crypto import (
    DeploymentCipher,
    DeploymentReEncryptingConsumer,
    register_deployment_consumer,
)
from uniffy.core.models.login.user_mfa import UserMfa

TOTP_SECRET_BYTES = 20


def generate_totp_secret() -> str:
    """Return a freshly random base32-encoded TOTP secret (no padding)."""
    raw = os.urandom(TOTP_SECRET_BYTES)
    return base64.b32encode(raw).decode("ascii").rstrip("=")


async def encrypt_totp_secret(session: AsyncSession, secret_b32: str) -> str:
    """Wrap a base32 TOTP secret in DeploymentCipher ciphertext."""
    return await DeploymentCipher(session).encrypt(secret_b32)


async def decrypt_totp_secret(session: AsyncSession, ciphertext: str) -> str:
    """Unwrap DeploymentCipher ciphertext back to the base32 TOTP secret."""
    return await DeploymentCipher(session).decrypt(ciphertext)


async def _list_user_mfa_rows(session: AsyncSession) -> AsyncIterator[UserMfa]:
    """Yield UserMfa rows that actually hold a secret.

    Pre-enrollment grace-tracking rows have ``totp_secret_encrypted=None``
    and are skipped by the rotation sweep.
    """
    result = await session.execute(select(UserMfa).where(UserMfa.totp_secret_encrypted.is_not(None)))
    for row in result.scalars():
        yield row


def _get_ciphertext(row: UserMfa) -> str:
    assert row.totp_secret_encrypted is not None
    return row.totp_secret_encrypted


def _set_ciphertext(row: UserMfa, ciphertext: str) -> None:
    row.totp_secret_encrypted = ciphertext


register_deployment_consumer(
    DeploymentReEncryptingConsumer(
        name="login_user_mfa",
        table_name="login_user_mfa",
        list_rows=_list_user_mfa_rows,
        get_ciphertext=_get_ciphertext,
        set_ciphertext=_set_ciphertext,
    )
)
