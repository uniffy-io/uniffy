"""Per-user + per-IP rate limiting and replay protection for MFA verify.

Three counters in Valkey, all keyed under the ``mfa`` namespace so the
metrics dashboards group them together:

* ``mfa:verify:user:{user_id}`` -- INCR with a 15-min TTL window.
  Locks at 5 failures. Cleared on success.
* ``mfa:verify:ip:{ip}`` -- same shape, 20-attempt cap. Mitigates one
  attacker hammering across leaked credentials from a single host.
* ``mfa:used:{user_id}:{counter}`` -- ``SET NX`` with a 90s TTL.
  ``counter`` is the TOTP 30-second step the accepted code falls
  inside; ``mark_code_used`` returns ``False`` when the key already
  exists, which the caller treats as a replay.

Fail-open: when Valkey is unreachable, all three helpers return the
permissive answer (not locked, never replayed). Per the same contract
the rest of the ops tier follows; a Valkey outage must not lock every
user out of MFA.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from enum import Enum
from uuid import UUID

from loguru import logger

from uniffy.core.valkey.ops import _get_ops_client, ops_call

logger = logger.bind(component="mfa")

_NAMESPACE = "mfa"

_USER_KEY = "mfa:verify:user:{user_id}"
_IP_KEY = "mfa:verify:ip:{ip}"
_USED_KEY = "mfa:used:{user_id}:{counter}"

_USER_WINDOW_SECONDS = 15 * 60
_IP_WINDOW_SECONDS = 15 * 60
_USER_MAX_ATTEMPTS = 5
_IP_MAX_ATTEMPTS = 20

_REPLAY_TTL_SECONDS = 90
TOTP_STEP_SECONDS = 30


class RateLimitVerdict(str, Enum):
    """Outcome of recording a verify attempt against the two counters."""

    OK = "ok"
    LOCKED_USER = "locked_user"
    LOCKED_IP = "locked_ip"


@dataclass(frozen=True)
class VerifyLockStatus:
    """Snapshot of the locks before an attempt is recorded."""

    user_locked: bool
    ip_locked: bool


async def is_verify_locked(user_id: UUID, ip: str | None) -> VerifyLockStatus:
    """Return whether either counter is already at its limit.

    Read-only. Used as a pre-check inside ``VerifyMfa`` so a locked
    user gets ``429`` without spending Argon2 time on a recovery-code
    verify or running the TOTP comparison.
    """
    client = _get_ops_client()
    if client is None:
        return VerifyLockStatus(user_locked=False, ip_locked=False)

    user_count = await _read_count(client, _USER_KEY.format(user_id=user_id))
    ip_count = (
        await _read_count(client, _IP_KEY.format(ip=ip))
        if ip
        else 0
    )
    return VerifyLockStatus(
        user_locked=user_count >= _USER_MAX_ATTEMPTS,
        ip_locked=ip_count >= _IP_MAX_ATTEMPTS,
    )


async def record_verify_attempt(
    user_id: UUID,
    ip: str | None,
    *,
    success: bool,
) -> RateLimitVerdict:
    """Bump the counters for one verify attempt.

    On ``success`` the per-user counter is cleared (the IP counter
    stays -- one IP can be hosting many users, clearing it on every
    success would let a single legitimate user shield an attacker
    racing other accounts). On failure both counters are incremented
    and the TTL re-armed.
    """
    client = _get_ops_client()
    if client is None:
        return RateLimitVerdict.OK

    user_key = _USER_KEY.format(user_id=user_id)
    if success:
        try:
            async with ops_call(_NAMESPACE, "verify_clear_user"):
                await client.delete(user_key)
        except Exception:  # noqa: BLE001
            pass
        return RateLimitVerdict.OK

    user_count = await _incr_with_ttl(client, user_key, _USER_WINDOW_SECONDS)
    if user_count >= _USER_MAX_ATTEMPTS:
        return RateLimitVerdict.LOCKED_USER

    if ip:
        ip_count = await _incr_with_ttl(
            client, _IP_KEY.format(ip=ip), _IP_WINDOW_SECONDS
        )
        if ip_count >= _IP_MAX_ATTEMPTS:
            return RateLimitVerdict.LOCKED_IP

    return RateLimitVerdict.OK


async def mark_code_used(user_id: UUID, counter: int) -> bool:
    """Record a TOTP counter as consumed. Returns ``False`` on replay.

    The 30-second TOTP step the accepted code lives inside is the
    natural counter; storing it for 90 seconds (the maximum drift
    window we accept) is enough to cover both the previous and next
    step that ``valid_window=1`` allows.
    """
    client = _get_ops_client()
    if client is None:
        return True
    try:
        async with ops_call(_NAMESPACE, "mark_code_used"):
            stored = await client.set(
                _USED_KEY.format(user_id=user_id, counter=counter),
                "1",
                ex=_REPLAY_TTL_SECONDS,
                nx=True,
            )
    except Exception:  # noqa: BLE001
        logger.warning("mfa.rate_limit: failed to set replay key", component="mfa")
        return True
    return bool(stored)


def totp_counter_now() -> int:
    """Return the TOTP counter for the current 30-second step."""
    return int(time.time()) // TOTP_STEP_SECONDS


async def _read_count(client, key: str) -> int:
    try:
        async with ops_call(_NAMESPACE, "verify_read"):
            raw = await client.get(key)
    except Exception:  # noqa: BLE001
        return 0
    if raw is None:
        return 0
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


async def _incr_with_ttl(client, key: str, ttl: int) -> int:
    try:
        async with ops_call(_NAMESPACE, "verify_incr"):
            value = await client.incr(key)
            if value == 1:
                await client.expire(key, ttl)
    except Exception:  # noqa: BLE001
        return 0
    return int(value)
