"""Binary Valkey client against the live server: raw bytes and verified instance identity."""

import asyncio
from time import monotonic

import pytest
import valkey.asyncio as aioredis
from prometheus_client import REGISTRY
from valkey.exceptions import ConnectionError as ValkeyConnectionError

from uniffy.core.realtime import preflight
from uniffy.core.realtime.buffer import BufferUnavailable, UpdateBuffer
from uniffy.core.realtime.buffer_keys import PendingUsage
from uniffy.core.realtime.preflight import READY_RETRY_SECONDS, preflight_result, run_preflight
from uniffy.infrastructure.valkey.binary import (
    POOL_WAIT_SECONDS,
    close_binary_client,
    get_binary_client,
    init_binary_client,
    server_identity,
    verify_server_identity,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")

# Every byte value, so any decoding step on the way would fail or alter it.
PAYLOAD = bytes(range(256))


def client() -> aioredis.Redis:
    binary = get_binary_client()
    assert binary is not None
    return binary


async def test_values_and_key_names_round_trip_as_raw_bytes(valkey_namespace: str) -> None:
    key = valkey_namespace.encode() + b"\xff\x00raw"

    await client().set(key, PAYLOAD)

    assert await client().get(key) == PAYLOAD
    assert [found async for found in client().scan_iter(match=f"{valkey_namespace}*")] == [key]


async def test_stream_entries_keep_binary_fields_and_explicit_ids(valkey_namespace: str) -> None:
    key = f"{valkey_namespace}stream"

    assert await client().xadd(key, {b"update": PAYLOAD}, id="42-0") == b"42-0"

    assert await client().xrange(key) == [(b"42-0", {b"update": PAYLOAD})]


async def test_client_reports_the_verified_serving_instance(valkey_namespace: str) -> None:
    identity = server_identity()

    assert identity is not None
    assert identity.run_id
    assert identity.version
    assert await verify_server_identity() == identity
    assert await client().ping() is True


async def test_preflight_reads_the_same_instance_through_the_binary_client(
    valkey_namespace: str,
) -> None:
    result = await run_preflight(client())
    identity = server_identity()

    assert identity is not None
    assert result.run_id == identity.run_id
    assert result.policy is not None


async def test_buffer_calls_bring_the_client_back_after_a_failed_start_at_a_bounded_rate(
    valkey_namespace: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    buffer = UpdateBuffer(namespace=valkey_namespace, pending_budget_bytes=1024)
    clock = [monotonic() + 3600]
    monkeypatch.setattr(preflight, "monotonic", lambda: clock[0])
    await close_binary_client()
    try:
        with monkeypatch.context() as unreachable:
            unreachable.setenv("VALKEY_HOST", "127.0.0.1")
            unreachable.setenv("VALKEY_PORT", "1")
            with pytest.raises(BufferUnavailable):
                await buffer.bucket_usage(0)
        # Valkey is reachable again, but the next attempt waits for the retry spacing.
        with pytest.raises(BufferUnavailable):
            await buffer.bucket_usage(0)
        clock[0] += READY_RETRY_SECONDS
        usage = await buffer.bucket_usage(0)
    finally:
        await init_binary_client()

    assert usage == PendingUsage(0, 0)
    assert get_binary_client() is not None
    assert server_identity() is not None
    assert preflight_result() is not None


def pool_waits(outcome: str) -> float:
    return (
        REGISTRY.get_sample_value("uniffy_valkey_binary_pool_waits_total", {"outcome": outcome})
        or 0.0
    )


async def test_a_call_waits_for_a_busy_pool_and_fails_only_when_nothing_frees_in_time(
    valkey_namespace: str,
) -> None:
    pool = client().connection_pool
    held = [await pool.get_connection("PING") for _ in range(pool.max_connections)]
    served, timed_out = pool_waits("served"), pool_waits("timeout")

    async def release_one() -> None:
        await asyncio.sleep(POOL_WAIT_SECONDS / 2)
        await pool.release(held.pop())

    try:
        freed = asyncio.create_task(release_one())
        waited = await client().ping()
        await freed
        # The released connection now serves the waiting call, so every slot is busy again.
        held.append(await pool.get_connection("PING"))
        started = monotonic()
        with pytest.raises(ValkeyConnectionError):
            await client().ping()
        gave_up_after = monotonic() - started
    finally:
        for connection in held:
            await pool.release(connection)

    assert waited is True
    assert pool_waits("served") == served + 1
    assert pool_waits("timeout") == timed_out + 1
    assert POOL_WAIT_SECONDS <= gave_up_after < 1.0
