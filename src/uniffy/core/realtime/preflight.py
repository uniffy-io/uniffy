"""Valkey deployment facts that decide whether buffered realtime edits are safe to accept."""

import os
from collections.abc import Awaitable
from dataclasses import dataclass
from enum import StrEnum
from time import monotonic
from typing import Any, Protocol

from loguru import logger
from valkey.exceptions import ResponseError

from uniffy.core.realtime.metrics import REALTIME_VALKEY_PREFLIGHT
from uniffy.infrastructure.valkey.binary import (
    get_binary_client,
    identity_from_info,
    init_binary_client,
)

logger = logger.bind(component="core.realtime.preflight")

_MIB = 1024 * 1024
# An unreachable Valkey costs each caller one connect timeout at most this often.
READY_RETRY_SECONDS = 5.0
_UNBOUNDED_BUDGET_BYTES = 256 * _MIB
_BUDGET_CAP_BYTES = 512 * _MIB
# Only allkeys-* evicts keys without a TTL; pending edit streams never carry one.
_EVICTING_POLICY_PREFIX = "allkeys-"


class PreflightMode(StrEnum):
    STRICT = "strict"
    WARN = "warn"


class PreflightVerdict(StrEnum):
    ENABLED = "enabled"
    DISABLED = "disabled"
    UNKNOWN = "unknown"


class _AppendFsync(StrEnum):
    ALWAYS = "always"
    EVERYSEC = "everysec"


class PreflightClient(Protocol):
    def info(self, section: str, /) -> Awaitable[Any]: ...

    def config_get(self, pattern: str, /) -> Awaitable[Any]: ...


@dataclass(frozen=True, slots=True)
class PreflightResult:
    """Serving Valkey facts for buffered edits. Only ``verdict`` gates admission."""

    policy: str | None
    maxmemory: int | None
    aof_enabled: bool | None
    rdb_save_configured: bool | None
    run_id: str
    version: str
    verdict: PreflightVerdict
    loss_window: str
    pending_budget_bytes: int


def _env_budget() -> int | None:
    raw = os.getenv("REALTIME_PENDING_BUDGET_BYTES", "").strip()
    return int(raw) if raw else None


PREFLIGHT_MODE = PreflightMode(
    (os.getenv("REALTIME_VALKEY_PREFLIGHT") or PreflightMode.STRICT).strip().lower()
)
PENDING_BUDGET_OVERRIDE = _env_budget()

_result: PreflightResult | None = None
_ready_attempted_at: float | None = None
_ready_failing = False


def preflight_result() -> PreflightResult | None:
    return _result


async def ensure_buffer_ready() -> None:
    """Bring up the binary client and preflight that a failed process start left missing."""
    global _ready_attempted_at, _ready_failing

    if get_binary_client() is not None and _result is not None:
        return
    now = monotonic()
    if _ready_attempted_at is not None and now - _ready_attempted_at < READY_RETRY_SECONDS:
        return
    _ready_attempted_at = now
    try:
        await init_binary_client()
        client = get_binary_client()
        if client is not None:
            await run_preflight(client)
    except Exception:
        if not _ready_failing:
            logger.opt(exception=True).warning("Valkey buffer for realtime edits is unavailable")
        _ready_failing = True
        return
    if _ready_failing:
        logger.info("Valkey buffer for realtime edits is available again")
    _ready_failing = False


async def run_preflight(
    client: PreflightClient,
    *,
    mode: PreflightMode = PREFLIGHT_MODE,
    budget_override: int | None = PENDING_BUDGET_OVERRIDE,
) -> PreflightResult:
    """Read the serving instance and publish the verdict admission consults.

    Persistence facts are reported with the loss window they imply and never gate.
    """
    global _result

    identity = identity_from_info(await client.info("server"))
    aof = (await client.info("persistence")).get("aof_enabled")
    policy = await _config_value(client, "maxmemory-policy")
    maxmemory_text = await _config_value(client, "maxmemory")
    save = await _config_value(client, "save")
    appendfsync = await _config_value(client, "appendfsync")

    maxmemory = None if maxmemory_text is None else int(maxmemory_text)
    aof_enabled = None if aof is None else bool(int(aof))
    rdb_save_configured = None if save is None else bool(save.strip())
    result = PreflightResult(
        policy=policy,
        maxmemory=maxmemory,
        aof_enabled=aof_enabled,
        rdb_save_configured=rdb_save_configured,
        run_id=identity.run_id,
        version=identity.version,
        verdict=_verdict(policy, mode),
        loss_window=_loss_window(aof_enabled, appendfsync, rdb_save_configured),
        pending_budget_bytes=_pending_budget(maxmemory, budget_override),
    )

    _result = result
    for verdict in PreflightVerdict:
        REALTIME_VALKEY_PREFLIGHT.labels(verdict=verdict).set(int(verdict is result.verdict))
    _log(result)
    return result


async def _config_value(client: PreflightClient, name: str) -> str | None:
    # Managed services rename or deny CONFIG; the fact stays unknown instead of failing.
    try:
        values = await client.config_get(name)
    except ResponseError:
        return None
    value = values.get(name)
    return None if value is None else str(value)


def _verdict(policy: str | None, mode: PreflightMode) -> PreflightVerdict:
    if policy is None:
        return PreflightVerdict.UNKNOWN
    if policy.startswith(_EVICTING_POLICY_PREFIX) and mode is PreflightMode.STRICT:
        return PreflightVerdict.DISABLED
    return PreflightVerdict.ENABLED


def _pending_budget(maxmemory: int | None, override: int | None) -> int:
    if override is not None:
        return override
    if not maxmemory:
        return _UNBOUNDED_BUDGET_BYTES
    return min(maxmemory // 4, _BUDGET_CAP_BYTES)


def _loss_window(aof_enabled: bool | None, appendfsync: str | None, rdb_save: bool | None) -> str:
    if aof_enabled:
        if appendfsync == _AppendFsync.ALWAYS:
            return "AOF fsync always: a crash loses no accepted edits"
        if appendfsync == _AppendFsync.EVERYSEC:
            return "AOF fsync everysec: a crash loses about one second of accepted edits"
        return "AOF without regular fsync: a crash loses accepted edits the OS has not flushed"
    if aof_enabled is None or rdb_save is None:
        return "persistence unknown: a restart may lose every uncheckpointed edit"
    if rdb_save:
        return "RDB snapshots only: a crash loses accepted edits since the last snapshot"
    return "no persistence: a restart loses every uncheckpointed edit"


def _log(result: PreflightResult) -> None:
    if result.verdict is PreflightVerdict.UNKNOWN:
        logger.warning(
            "Valkey eviction policy is unreadable; buffered realtime edits require "
            "maxmemory-policy noeviction or volatile-*, never allkeys-*"
        )
    elif result.verdict is PreflightVerdict.DISABLED:
        logger.error(
            "Valkey maxmemory-policy {policy} can evict pending realtime edits; buffered "
            "acceptance is disabled. Set maxmemory-policy to noeviction or volatile-*, or "
            "REALTIME_VALKEY_PREFLIGHT=warn to accept that loss",
            policy=result.policy,
        )
    elif result.policy and result.policy.startswith(_EVICTING_POLICY_PREFIX):
        logger.warning(
            "Valkey maxmemory-policy {policy} can evict pending realtime edits; "
            "REALTIME_VALKEY_PREFLIGHT=warn keeps buffered acceptance enabled",
            policy=result.policy,
        )
    logger.info(
        "Valkey {version} (run_id {run_id}) persistence: {loss_window}; pending budget "
        "{budget} bytes",
        version=result.version,
        run_id=result.run_id,
        loss_window=result.loss_window,
        budget=result.pending_budget_bytes,
    )
