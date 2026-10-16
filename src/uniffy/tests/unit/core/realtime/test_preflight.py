import pytest
from prometheus_client import REGISTRY
from valkey.exceptions import ResponseError

from uniffy.core.realtime.preflight import (
    PreflightMode,
    PreflightResult,
    PreflightVerdict,
    preflight_result,
    run_preflight,
)

MIB = 1024 * 1024
RUN_ID = "565deefd1b36dff07a7d63be7f9b8352d97885ec"


class FakeValkey:
    """Answers INFO and CONFIG GET from fixed facts; ``config=None`` acts like a renamed CONFIG."""

    def __init__(self, config: dict[str, str] | None, *, aof_enabled: int = 1) -> None:
        self.sections: dict[str, dict[str, object]] = {
            "server": {"run_id": RUN_ID, "valkey_version": "9.1.2", "redis_version": "7.2.4"},
            "persistence": {"aof_enabled": aof_enabled},
        }
        self.config = config

    async def info(self, section: str) -> dict[str, object]:
        return self.sections[section]

    async def config_get(self, pattern: str) -> dict[str, str]:
        if self.config is None:
            raise ResponseError("unknown command 'CONFIG', with args beginning with: 'GET'")
        return {pattern: self.config[pattern]} if pattern in self.config else {}


def config(
    policy: str = "noeviction",
    maxmemory: int = 0,
    save: str = "3600 1 300 100 60 10000",
    appendfsync: str = "everysec",
) -> dict[str, str]:
    return {
        "maxmemory-policy": policy,
        "maxmemory": str(maxmemory),
        "save": save,
        "appendfsync": appendfsync,
    }


async def preflight(
    client: FakeValkey,
    *,
    mode: PreflightMode = PreflightMode.STRICT,
    budget_override: int | None = None,
) -> PreflightResult:
    return await run_preflight(client, mode=mode, budget_override=budget_override)


@pytest.mark.parametrize("policy", ["noeviction", "volatile-lru"])
async def test_policy_without_ttl_free_eviction_enables_buffering(policy: str) -> None:
    result = await preflight(FakeValkey(config(policy=policy)))

    assert result.verdict is PreflightVerdict.ENABLED
    assert result.policy == policy
    assert (result.run_id, result.version) == (RUN_ID, "9.1.2")


async def test_allkeys_policy_disables_buffering_in_strict_mode() -> None:
    result = await preflight(FakeValkey(config(policy="allkeys-lru")))

    assert result.verdict is PreflightVerdict.DISABLED


async def test_warn_mode_keeps_buffering_on_allkeys_policy() -> None:
    result = await preflight(FakeValkey(config(policy="allkeys-lru")), mode=PreflightMode.WARN)

    assert result.verdict is PreflightVerdict.ENABLED
    assert result.policy == "allkeys-lru"


async def test_unreadable_config_stays_unknown_with_default_budget() -> None:
    result = await preflight(FakeValkey(None))

    assert result.verdict is PreflightVerdict.UNKNOWN
    assert (result.policy, result.maxmemory, result.rdb_save_configured) == (None, None, None)
    assert result.aof_enabled is True
    assert result.run_id == RUN_ID
    assert result.pending_budget_bytes == 256 * MIB


@pytest.mark.parametrize(
    ("maxmemory", "override", "budget"),
    [
        (0, None, 256 * MIB),
        (800 * MIB, None, 200 * MIB),
        (8 * 1024 * MIB, None, 512 * MIB),
        (8 * 1024 * MIB, 64 * MIB, 64 * MIB),
        (0, 3 * MIB, 3 * MIB),
    ],
)
async def test_pending_budget_follows_maxmemory_unless_overridden(
    maxmemory: int, override: int | None, budget: int
) -> None:
    result = await preflight(FakeValkey(config(maxmemory=maxmemory)), budget_override=override)

    assert result.maxmemory == maxmemory
    assert result.pending_budget_bytes == budget


@pytest.mark.parametrize(
    ("aof_enabled", "save", "facts"),
    [
        (1, "3600 1", (True, True)),
        (0, "3600 1", (False, True)),
        (0, "", (False, False)),
    ],
)
async def test_persistence_is_reported_and_never_gates(
    aof_enabled: int, save: str, facts: tuple[bool, bool]
) -> None:
    result = await preflight(FakeValkey(config(save=save), aof_enabled=aof_enabled))

    assert (result.aof_enabled, result.rdb_save_configured) == facts
    assert result.verdict is PreflightVerdict.ENABLED


async def test_latest_result_is_published_for_admission_and_metrics() -> None:
    result = await preflight(FakeValkey(config(policy="allkeys-lfu")))

    assert preflight_result() == result
    samples = {
        verdict: REGISTRY.get_sample_value(
            "uniffy_realtime_valkey_preflight", {"verdict": verdict.value}
        )
        for verdict in PreflightVerdict
    }
    assert samples == {
        PreflightVerdict.ENABLED: 0.0,
        PreflightVerdict.DISABLED: 1.0,
        PreflightVerdict.UNKNOWN: 0.0,
    }
