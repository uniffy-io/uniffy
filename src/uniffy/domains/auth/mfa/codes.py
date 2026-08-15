"""MFA recovery codes -- generation, hashing, verify, persistence.

Each code is twelve characters from the lower-cased base32 alphabet
(RFC 4648 -- ``a-z2-7``, no visually-ambiguous ``0``/``1``/``8``/``9``)
grouped into three dash-separated quads. That is 12 chars * 5 bits =
60 bits of entropy per code, well above the 6-digit TOTP value we
back up.

Hashes use Argon2id directly via ``argon2-cffi`` -- the codebase
already runs bcrypt for password hashes, so we keep that and add
Argon2 for the recovery-code path. Argon2id parameters land at
``time_cost=2``, ``memory_cost=64 MiB``, ``parallelism=2`` per the
plan; that costs a handful of milliseconds per verify, which is fine
for an action that fires once per recovery event (never per login).
"""

from __future__ import annotations

import secrets
from uuid import UUID

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.login.user_recovery_code import UserRecoveryCode

RECOVERY_CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"
RECOVERY_CODE_GROUP_LEN = 4
RECOVERY_CODE_GROUPS = 3
RECOVERY_CODE_COUNT = 10

_HASHER = PasswordHasher(
    time_cost=2,
    memory_cost=65536,
    parallelism=2,
)


def generate_recovery_code() -> str:
    """Return one ``xxxx-xxxx-xxxx`` recovery code."""
    groups = [
        "".join(secrets.choice(RECOVERY_CODE_ALPHABET) for _ in range(RECOVERY_CODE_GROUP_LEN))
        for _ in range(RECOVERY_CODE_GROUPS)
    ]
    return "-".join(groups)


def generate_recovery_codes(n: int = RECOVERY_CODE_COUNT) -> list[str]:
    """Return ``n`` fresh recovery codes."""
    return [generate_recovery_code() for _ in range(n)]


def hash_recovery_code(code: str) -> str:
    """Argon2id-hash a plaintext recovery code."""
    return _HASHER.hash(_normalise(code))


def verify_recovery_code(code: str, code_hash: str) -> bool:
    """Constant-time check of a submitted code against one stored hash."""
    try:
        return _HASHER.verify(code_hash, _normalise(code))
    except VerifyMismatchError, InvalidHashError:
        return False


def _normalise(code: str) -> str:
    """Lower-case + strip spaces / dashes so users can paste loosely."""
    return code.strip().lower().replace(" ", "").replace("-", "")


async def replace_recovery_codes(
    session: AsyncSession,
    *,
    user_id: UUID,
    codes: list[str],
) -> None:
    """Drop the user's existing rows and persist a fresh batch.

    Used by enrollment confirmation and regenerate. The caller commits.
    """
    await session.execute(delete(UserRecoveryCode).where(UserRecoveryCode.user_id == user_id))
    for code in codes:
        session.add(
            UserRecoveryCode(
                user_id=user_id,
                code_hash=hash_recovery_code(code),
            )
        )
