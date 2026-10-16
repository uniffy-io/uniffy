"""Buffer epochs: latest-state loading, recovery and resets on live Valkey and PostgreSQL."""

import asyncio
import dataclasses
from typing import Any
from uuid import uuid4

import pycrdt
import pytest

from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.buffer import BufferUnavailable, RecoveryReason, RecoveryRequired
from uniffy.core.realtime.buffer_keys import (
    AdmissionOutcome,
    AdmissionStatus,
    BufferHead,
    PendingUsage,
    buffer_keys,
)
from uniffy.core.realtime.markdown import markdown_text
from uniffy.core.realtime.preflight import PreflightVerdict, preflight_result, run_preflight
from uniffy.core.types import ContentType
from uniffy.infrastructure.valkey.binary import get_binary_client, server_identity
from uniffy.tests.integration.access.realtime_buffers import (
    STALE_RUN_ID,
    edit,
    env,  # noqa: F401 - fixture
    establish,
    gauge,
    latest,
    offer,
    receipt,
    relayed,  # noqa: F401 - fixture
    set_row,
    stored_row,
)
from uniffy.tests.integration.access.realtime_live import text_of, valkey

pytestmark = pytest.mark.asyncio(loop_scope="session")

RESTARTED_RUN_IDS = ("a" * 40, "b" * 40)


def epoch_resets(reason: RecoveryReason) -> float:
    return gauge("uniffy_realtime_buffer_epoch_resets_total", {"reason": reason.value})


async def test_loader_rebuilds_on_cache_miss_and_reuses_the_checkpoint_on_hit(env) -> None:
    head = await establish(env)
    await offer(env, head, "u-1", edit(env.base, " Alice"))

    first = await latest(env)
    assert first is not None
    assert first.head == BufferHead(head.scope, 1, 0, head.checkpoint_revision, head.run_id)
    assert first.checkpoint == env.base
    assert [record.update_id for record in first.tail] == ["u-1"]
    assert text_of(first.merged()) == "base Alice"

    replaced = pycrdt.Doc()
    markdown_text(replaced).insert(0, "rewritten")
    await set_row(env.key, updates=replaced.get_update())
    await offer(env, head, "u-2", edit(env.base, " Bob"))
    hit = await latest(env)

    assert hit is not None
    assert hit.checkpoint == env.base
    assert [record.update_id for record in hit.tail] == ["u-1", "u-2"]
    assert hit.head.head_seq == 2

    await set_row(env.key, revision=RealtimeYjsSnapshot.revision + 1)
    miss = await latest(env)

    assert miss is not None
    assert miss.checkpoint == replaced.get_update()
    assert miss.head.checkpoint_revision == head.checkpoint_revision + 1
    assert [record.update_id for record in miss.tail] == ["u-1", "u-2"]


async def test_loader_returns_nothing_for_a_document_without_a_checkpoint(env) -> None:
    assert await latest(env, (ContentType.NOTE, uuid4())) is None


async def test_loader_reports_a_gap_in_the_tail(env) -> None:
    head = await establish(env)
    for index in range(3):
        await offer(env, head, f"u-{index}", edit(env.base, f" {index}"))
    await valkey().xdel(buffer_keys(head.scope, env.namespace).stream, "2-0")

    with pytest.raises(RecoveryRequired) as failure:
        await latest(env)

    assert failure.value.reason is RecoveryReason.GAP


async def test_loader_reports_a_tail_below_the_postgres_watermark(env) -> None:
    head = await establish(env)
    await offer(env, head, "u-1", edit(env.base, " Alice"))
    await set_row(env.key, checkpoint_seq=5)

    with pytest.raises(RecoveryRequired) as failure:
        await latest(env)

    assert failure.value.reason is RecoveryReason.STALE_TAIL


async def test_missing_control_is_reported_then_reset_keeps_the_surviving_prefix(env) -> None:
    head = await establish(env)
    await offer(env, head, "u-1", edit(env.base, " Alice"))
    await offer(env, head, "u-2", edit(env.base, " Bob"))
    await valkey().delete(buffer_keys(head.scope, env.namespace).control)

    with pytest.raises(RecoveryRequired) as failure:
        await latest(env)
    fresh = await establish(env)
    state = await latest(env)

    assert failure.value.reason is RecoveryReason.MISSING_CONTROL
    assert fresh.scope.epoch != head.scope.epoch
    assert state is not None
    assert state.tail == ()
    assert text_of(state.checkpoint) in {"base Alice Bob", "base Bob Alice"}


async def test_run_id_change_forces_a_fresh_epoch_with_the_surviving_prefix_staged(env) -> None:
    head = await establish(env)
    old_keys = buffer_keys(head.scope, env.namespace)
    old = await offer(env, head, "u-1", edit(env.base, " Alice"))
    await offer(env, head, "u-2", edit(env.base, " Bob"))
    # The epoch was issued by an instance that has since restarted, keys intact.
    await set_row(env.key, valkey_run_id=STALE_RUN_ID)

    with pytest.raises(RecoveryRequired) as failure:
        await latest(env)
    fresh = await establish(env)

    assert failure.value.reason is RecoveryReason.IDENTITY_CHANGED
    row = await stored_row(env.key)
    identity = server_identity()
    assert identity is not None
    assert fresh.scope.generation == head.scope.generation == row.generation
    assert fresh.scope.epoch != head.scope.epoch
    assert (row.buffer_epoch, row.valkey_run_id, row.checkpoint_seq) == (
        fresh.scope.epoch,
        identity.run_id,
        0,
    )
    assert (fresh.head_seq, fresh.checkpoint_seq) == (0, 0)
    assert row.revision == head.checkpoint_revision + 1
    assert row.actor_id == env.actor
    assert text_of(row.updates) in {"base Alice Bob", "base Bob Alice"}
    assert await valkey().exists(old_keys.stream, old_keys.control, old_keys.receipts) == 0
    assert await valkey().zscore(old_keys.due, head.scope.member) is None
    assert await env.buffer.bucket_usage(head.scope.bucket) == PendingUsage(0, 0)

    carol = await offer(env, fresh, "u-3", edit(env.base, " Carol"))

    # Sequence 1 is issued again, but only inside the new epoch, so the old receipt never matches.
    assert carol == AdmissionOutcome(AdmissionStatus.ACCEPTED, receipt(fresh, 1, "u-3"))
    assert old == AdmissionOutcome(AdmissionStatus.ACCEPTED, receipt(head, 1, "u-1"))
    state = await latest(env)
    assert state is not None
    assert [record.update_id for record in state.tail] == ["u-3"]
    assert "Carol" in text_of(state.merged()) and "Alice" in text_of(state.merged())


async def test_admission_under_a_head_from_another_instance_requires_recovery(env) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)

    outcome = await offer(
        env, dataclasses.replace(head, run_id=STALE_RUN_ID), "u-1", edit(env.base, " late")
    )

    assert outcome == AdmissionOutcome(AdmissionStatus.RECOVERY_REQUIRED)
    assert await valkey().exists(keys.stream, keys.receipts) == 0


async def test_admission_with_a_retired_epoch_requires_recovery(env) -> None:
    head = await establish(env)
    await set_row(env.key, valkey_run_id=STALE_RUN_ID)
    await establish(env)

    stale = await offer(env, head, "u-1", edit(env.base, " late"))

    assert stale == AdmissionOutcome(AdmissionStatus.RECOVERY_REQUIRED)
    assert await valkey().exists(buffer_keys(head.scope, env.namespace).stream) == 0


async def test_failed_staging_leaves_the_old_epoch_intact_for_retry(env) -> None:
    head = await establish(env)
    await offer(env, head, "u-1", edit(env.base, " Alice"))
    await set_row(env.key, valkey_run_id=STALE_RUN_ID)

    async def interrupted(*_: Any) -> None:
        raise OSError("database connection lost")

    with pytest.raises(OSError):
        await establish(env, stage=interrupted)
    row = await stored_row(env.key)

    assert (row.buffer_epoch, row.valkey_run_id, row.checkpoint_seq) == (
        head.scope.epoch,
        STALE_RUN_ID,
        0,
    )
    assert await valkey().xlen(buffer_keys(head.scope, env.namespace).stream) == 1

    retried = await establish(env)

    assert retried.scope.epoch != head.scope.epoch
    assert text_of((await stored_row(env.key)).updates) == "base Alice"


async def test_reset_interrupted_before_control_initialization_moves_to_a_fresh_epoch(
    env,
) -> None:
    first = await establish(env)
    await set_row(env.key, valkey_run_id=STALE_RUN_ID)
    committed = await establish(env)
    # Same stored state as a Valkey that lost the control record after the epoch commit.
    await valkey().delete(buffer_keys(committed.scope, env.namespace).control)

    settled = await establish(env)
    outcome = await offer(env, settled, "u-1", edit(env.base, " Alice"))

    assert len({first.scope.epoch, committed.scope.epoch, settled.scope.epoch}) == 3
    assert outcome == AdmissionOutcome(AdmissionStatus.ACCEPTED, receipt(settled, 1, "u-1"))
    assert await valkey().exists(buffer_keys(committed.scope, env.namespace).control) == 0
    assert (await stored_row(env.key)).buffer_epoch == settled.scope.epoch


async def test_forced_reset_after_a_gap_stages_only_the_contiguous_prefix(env) -> None:
    head = await establish(env)
    for index, name in enumerate((" Alice", " Bob", " Carol")):
        await offer(env, head, f"u-{index}", edit(env.base, name))
    await valkey().xdel(buffer_keys(head.scope, env.namespace).stream, "2-0")

    fresh = await establish(env, reset=RecoveryReason.GAP)

    assert fresh.scope.epoch != head.scope.epoch
    assert text_of((await stored_row(env.key)).updates) == "base Alice"
    # The record beyond the gap stays for investigation instead of being trimmed away.
    leftover = await valkey().xrange(buffer_keys(head.scope, env.namespace).stream)
    assert [entry_id for entry_id, _ in leftover] == [b"3-0"]


async def test_concurrent_first_establishments_settle_on_one_epoch_with_one_reset(env) -> None:
    before = epoch_resets(RecoveryReason.UNINITIALIZED)

    heads = await asyncio.gather(*(establish(env) for _ in range(3)))

    assert len({head.scope.epoch for head in heads}) == 1
    assert epoch_resets(RecoveryReason.UNINITIALIZED) == before + 1
    assert (await stored_row(env.key)).buffer_epoch == heads[0].scope.epoch
    assert await valkey().hget(buffer_keys(heads[0].scope, env.namespace).control, "head") == b"0"


async def test_reset_retires_records_the_checkpoint_already_covers(env) -> None:
    head = await establish(env)
    await offer(env, head, "u-1", edit(env.base, " Alice"))
    await offer(env, head, "u-2", edit(env.base, " Bob"))
    # A checkpoint covered both records, then Valkey restarted before cleanup trimmed them.
    await set_row(env.key, checkpoint_seq=2, valkey_run_id=STALE_RUN_ID)

    fresh = await establish(env)

    old = buffer_keys(head.scope, env.namespace)
    assert fresh.scope.epoch != head.scope.epoch
    assert await valkey().exists(old.stream, old.control, old.receipts) == 0
    assert await valkey().zscore(old.due, head.scope.member) is None
    assert await env.buffer.bucket_usage(head.scope.bucket) == PendingUsage(0, 0)


async def test_reset_after_a_lost_stream_releases_its_pending_bytes(env) -> None:
    head = await establish(env)
    await offer(env, head, "u-1", edit(env.base, " Alice"))
    await offer(env, head, "u-2", edit(env.base, " Bob"))
    # Eviction or an operator removed the stream; its control and the bucket total survived.
    await valkey().delete(buffer_keys(head.scope, env.namespace).stream)

    with pytest.raises(RecoveryRequired) as lost:
        await latest(env)
    fresh = await establish(env, reset=lost.value.reason)

    assert lost.value.reason is RecoveryReason.GAP
    assert fresh.scope.epoch != head.scope.epoch
    assert await env.buffer.bucket_usage(head.scope.bucket) == PendingUsage(0, 0)
    assert text_of((await stored_row(env.key)).updates) == "base"


async def test_restarted_valkey_refuses_appends_until_the_document_moves_to_a_fresh_epoch(
    env, relayed
) -> None:
    head = await establish(env)
    alice = await offer(env, head, "u-1", edit(env.base, " Alice"))

    await relayed.restart(RESTARTED_RUN_IDS[0])
    refused = await offer(env, head, "u-2", edit(env.base, " Bob"))
    adopted = server_identity()
    fresh = await establish(env)
    carol = await offer(env, fresh, "u-3", edit(env.base, " Carol"))

    await relayed.restart(RESTARTED_RUN_IDS[1])
    with pytest.raises(RecoveryRequired) as lost:
        await latest(env)
    readopted = server_identity()
    settled = await establish(env)

    assert alice.status is AdmissionStatus.ACCEPTED
    assert refused == AdmissionOutcome(AdmissionStatus.RECOVERY_REQUIRED)
    assert adopted is not None and adopted.run_id == RESTARTED_RUN_IDS[0]
    assert fresh.scope.epoch != head.scope.epoch
    assert fresh.run_id == RESTARTED_RUN_IDS[0]
    assert carol == AdmissionOutcome(AdmissionStatus.ACCEPTED, receipt(fresh, 1, "u-3"))
    assert lost.value.reason is RecoveryReason.IDENTITY_CHANGED
    assert readopted is not None and readopted.run_id == RESTARTED_RUN_IDS[1]
    assert settled.scope.epoch not in {head.scope.epoch, fresh.scope.epoch}
    row = await stored_row(env.key)
    assert (row.buffer_epoch, row.valkey_run_id) == (settled.scope.epoch, RESTARTED_RUN_IDS[1])
    text = text_of(row.updates)
    assert "Alice" in text and "Carol" in text and "Bob" not in text


async def test_an_instance_change_reruns_the_preflight_and_an_evicting_policy_refuses_appends(
    env, relayed
) -> None:
    head = await establish(env)
    alice = await offer(env, head, "u-1", edit(env.base, " Alice"))
    before = preflight_result()

    # The client fails over to an instance that evicts keys without a TTL.
    relayed.policy = "allkeys-lru"
    await relayed.restart(RESTARTED_RUN_IDS[0])
    refused = await offer(env, head, "u-2", edit(env.base, " Bob"))
    try:
        fresh = await establish(env)
        after = preflight_result()
        with pytest.raises(BufferUnavailable):
            await offer(env, fresh, "u-3", edit(env.base, " Carol"))
    finally:
        relayed.policy = None
        client = get_binary_client()
        assert client is not None
        await run_preflight(client)

    assert alice.status is AdmissionStatus.ACCEPTED
    assert before is not None and before.verdict is PreflightVerdict.ENABLED
    assert refused == AdmissionOutcome(AdmissionStatus.RECOVERY_REQUIRED)
    assert after is not None
    assert (after.run_id, after.policy, after.verdict) == (
        RESTARTED_RUN_IDS[0],
        "allkeys-lru",
        PreflightVerdict.DISABLED,
    )
    assert fresh.run_id == RESTARTED_RUN_IDS[0]
    assert await valkey().exists(buffer_keys(fresh.scope, env.namespace).stream) == 0
