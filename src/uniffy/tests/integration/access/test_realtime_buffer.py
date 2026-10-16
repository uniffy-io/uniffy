"""Update buffer admission, limits and accounting on live Valkey in a disposable namespace."""

from uuid import uuid4

import pytest

from uniffy.core.crypto import SEAL_OVERHEAD_BYTES, OrgDataCipher
from uniffy.core.realtime.buffer import (
    AdmissionUnknown,
    BufferUnavailable,
    RecoveryReason,
    UpdateBuffer,
)
from uniffy.core.realtime.buffer_keys import (
    BUCKET_COUNT,
    DUE_DELAY_MS,
    MAX_PENDING_DOCUMENT_BYTES,
    MAX_PENDING_DOCUMENT_RECORDS,
    AdmissionOutcome,
    AdmissionStatus,
    PendingUsage,
    TrimResult,
    accounting_key,
    buffer_keys,
    stored_bytes,
)
from uniffy.core.realtime.limits import MAX_FRAME_BYTES
from uniffy.core.realtime.wire import MAX_WIRE_STRING_BYTES
from uniffy.infrastructure.valkey.binary import server_identity
from uniffy.tests.integration.access.realtime_buffers import (
    bucket_mates,  # noqa: F401 - fixture
    edit,
    env,  # noqa: F401 - fixture
    establish,
    foreign_organizations,  # noqa: F401 - fixture
    gauge,
    offer,
    proxied,  # noqa: F401 - fixture
    receipt,
    stored_cost,
    stored_row,
)
from uniffy.tests.integration.access.realtime_live import BUDGET, buffering_disabled, valkey

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_first_establishment_binds_a_fresh_epoch_to_the_serving_instance(env) -> None:
    head = await establish(env)
    row = await stored_row(env.key)
    identity = server_identity()

    assert identity is not None
    assert (row.buffer_epoch, row.valkey_run_id, row.checkpoint_seq) == (
        head.scope.epoch,
        identity.run_id,
        0,
    )
    assert head.scope.generation == row.generation
    assert (head.head_seq, head.checkpoint_seq, head.checkpoint_revision, head.run_id) == (
        0,
        0,
        row.revision,
        identity.run_id,
    )
    assert await establish(env) == head


async def test_accepted_update_stores_record_receipt_due_entry_and_counters(env) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)
    alice, bob = edit(env.base, " Alice"), edit(env.base, " Bob")

    first = await offer(env, head, "u-1", alice)
    control = await valkey().hgetall(keys.control)
    second = await offer(env, head, "u-2", bob)

    assert first == AdmissionOutcome(AdmissionStatus.ACCEPTED, receipt(head, 1, "u-1"))
    assert second == AdmissionOutcome(AdmissionStatus.ACCEPTED, receipt(head, 2, "u-2"))
    entries = await valkey().xrange(keys.stream)
    assert [entry_id for entry_id, _ in entries] == [b"1-0", b"2-0"]
    fields = entries[0][1]
    assert (fields[b"i"], fields[b"u"], fields[b"a"], fields[b"v"]) == (
        b"u-1",
        first.sealed,
        str(env.actor).encode(),
        b"2",
    )
    first_pending = int(control[b"first_ms"])
    assert int(fields[b"t"]) == first_pending
    after = await valkey().hgetall(keys.control)
    assert (after[b"head"], after[b"records"], after[b"first_ms"]) == (
        b"2",
        b"2",
        control[b"first_ms"],
    )
    stored = stored_bytes("u-1", alice) + stored_bytes("u-2", bob)
    assert int(after[b"bytes"]) == stored
    # The latest append time marks the epoch busy for idle reclaim.
    assert int(after[b"last_ms"]) == int(entries[1][1][b"t"])
    digest = await OrgDataCipher().receipt_digest(env.org, bob)
    assert await valkey().hget(keys.receipts, "u-2") == f"2:{digest}".encode()
    assert await valkey().zscore(keys.due, head.scope.member) == first_pending + DUE_DELAY_MS
    assert await env.buffer.bucket_usage(head.scope.bucket) == PendingUsage(stored, 2)
    assert await env.buffer.organization_usage(head.scope.bucket, env.org) == stored
    assert head.scope.member.encode() in await valkey().smembers(keys.scopes)
    for key in (keys.stream, keys.control, keys.receipts):
        assert await valkey().ttl(key) == -1


async def test_duplicate_update_id_with_same_bytes_returns_the_existing_sequence(env) -> None:
    head = await establish(env)
    payload = edit(env.base, " once")

    first = await offer(env, head, "u-1", payload)
    again = await offer(env, head, "u-1", payload)

    assert again == AdmissionOutcome(AdmissionStatus.DUPLICATE, first.receipt)
    assert await valkey().xlen(buffer_keys(head.scope, env.namespace).stream) == 1
    assert await env.buffer.bucket_usage(head.scope.bucket) == PendingUsage(
        stored_bytes("u-1", payload), 1
    )


async def test_duplicate_update_id_with_changed_bytes_is_an_id_conflict(env) -> None:
    head = await establish(env)
    original, changed = edit(env.base, " original"), edit(env.base, " changed")
    keys = buffer_keys(head.scope, env.namespace)

    stored = await offer(env, head, "u-1", original)
    conflict = await offer(env, head, "u-1", changed)

    assert conflict == AdmissionOutcome(AdmissionStatus.ID_CONFLICT)
    assert conflict.sealed is None
    assert [fields[b"u"] for _, fields in await valkey().xrange(keys.stream)] == [stored.sealed]


@pytest.mark.parametrize(
    ("update_id", "payload"),
    [
        ("", b"u"),
        ("x" * (MAX_WIRE_STRING_BYTES + 1), b"u"),
        ("u-1", b""),
        ("u-1", b"u" * (MAX_FRAME_BYTES + 1)),
    ],
)
async def test_wrong_type_arguments_are_refused_before_any_write(
    env, update_id: str, payload: bytes
) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)

    outcome = await offer(env, head, update_id, payload)

    assert outcome == AdmissionOutcome(AdmissionStatus.TYPE_ERROR)
    assert await valkey().exists(keys.stream, keys.receipts) == 0
    assert await valkey().hget(keys.control, "head") == b"0"


async def test_buffer_key_holding_another_type_is_a_type_error_and_nothing_is_written(
    env,
) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)
    await valkey().set(keys.receipts, b"not a hash")

    outcome = await offer(env, head, "u-1", edit(env.base, " lost"))

    assert outcome == AdmissionOutcome(AdmissionStatus.TYPE_ERROR)
    assert await valkey().exists(keys.stream) == 0
    assert await valkey().hget(keys.control, "head") == b"0"
    assert await valkey().get(keys.receipts) == b"not a hash"


async def test_document_record_limit_refuses_further_edits_without_trimming(env) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)

    outcomes = {
        (await offer(env, head, f"u-{index}", b"x")).status
        for index in range(MAX_PENDING_DOCUMENT_RECORDS)
    }
    refused = await offer(env, head, "over", b"x")

    assert outcomes == {AdmissionStatus.ACCEPTED}
    assert refused == AdmissionOutcome(AdmissionStatus.DOCUMENT_LIMIT)
    assert await valkey().xlen(keys.stream) == MAX_PENDING_DOCUMENT_RECORDS
    assert (await valkey().xrange(keys.stream, count=1))[0][0] == b"1-0"


async def test_document_byte_limit_counts_stored_bytes_and_refuses_without_trimming(env) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)
    chunk = b"x" * MAX_FRAME_BYTES
    # Ids and entry overhead count too, so one payload-sized chunk less fits than raw bytes allow.
    fitting = MAX_PENDING_DOCUMENT_BYTES // MAX_FRAME_BYTES - 1

    outcomes = {(await offer(env, head, f"u-{index}", chunk)).status for index in range(fitting)}
    refused = await offer(env, head, "over", chunk)
    small = await offer(env, head, "small", b"x")

    assert outcomes == {AdmissionStatus.ACCEPTED}
    assert refused == AdmissionOutcome(AdmissionStatus.DOCUMENT_LIMIT)
    assert small.status is AdmissionStatus.ACCEPTED
    entries = await valkey().xrange(keys.stream)
    assert len(entries) == fitting + 1
    assert await env.buffer.bucket_usage(head.scope.bucket) == PendingUsage(
        stored_cost(entries), fitting + 1
    )
    assert stored_cost(entries) <= MAX_PENDING_DOCUMENT_BYTES


# Ids of three bytes make each of these payloads cost exactly a quarter of a 1200-byte bucket.
QUARTER = b"x" * (300 - stored_bytes("u-1", b""))
BUCKET_BUDGET = 1200


async def test_one_document_holds_a_quarter_of_its_bucket_and_one_organization_half_of_it(
    env, bucket_mates, foreign_organizations
) -> None:
    small = UpdateBuffer(namespace=env.namespace, pending_budget_bytes=BUCKET_COUNT * BUCKET_BUDGET)
    owner = await establish(env)
    bucket = owner.scope.bucket
    sibling, third = [await establish(env, key) for key in await bucket_mates(bucket, 2)]
    other_org, _ = foreign_organizations
    (stranger,) = [
        await establish(env, key, organization=other_org)
        for key in await bucket_mates(bucket, 1, other_org)
    ]

    filled = await offer(env, owner, "u-1", QUARTER, buffer=small)
    capped = await offer(env, owner, "u-2", b"x", buffer=small)
    second = await offer(env, sibling, "u-1", QUARTER, buffer=small)
    starved = await offer(env, third, "u-1", QUARTER, buffer=small)
    unaffected = await offer(env, stranger, "u-1", QUARTER, buffer=small)
    await small.trim_committed(owner.scope, 1)
    released = await offer(env, third, "u-1", QUARTER, buffer=small)

    assert filled.status is AdmissionStatus.ACCEPTED
    assert capped == AdmissionOutcome(AdmissionStatus.DOCUMENT_LIMIT)
    assert second.status is AdmissionStatus.ACCEPTED
    assert starved == AdmissionOutcome(AdmissionStatus.ORGANIZATION_LIMIT)
    assert unaffected.status is AdmissionStatus.ACCEPTED
    assert released.status is AdmissionStatus.ACCEPTED
    assert await small.organization_usage(bucket, env.org) == 600
    assert await small.organization_usage(bucket, other_org) == 300
    assert await small.bucket_usage(bucket) == PendingUsage(900, 3)


async def test_the_bucket_refuses_at_budget_once_organizations_fill_it(
    env, bucket_mates, foreign_organizations
) -> None:
    small = UpdateBuffer(namespace=env.namespace, pending_budget_bytes=BUCKET_COUNT * BUCKET_BUDGET)
    owner = await establish(env)
    bucket = owner.scope.bucket
    (sibling,) = [await establish(env, key) for key in await bucket_mates(bucket, 1)]
    other_org, third_org = foreign_organizations
    strangers = [
        await establish(env, key, organization=other_org)
        for key in await bucket_mates(bucket, 2, other_org)
    ]
    (late,) = [
        await establish(env, key, organization=third_org)
        for key in await bucket_mates(bucket, 1, third_org)
    ]

    filled = [
        await offer(env, head, "u-1", QUARTER, buffer=small) for head in (owner, sibling, *strangers)
    ]
    exhausted = await offer(env, late, "u-1", QUARTER, buffer=small)

    assert {outcome.status for outcome in filled} == {AdmissionStatus.ACCEPTED}
    assert exhausted == AdmissionOutcome(AdmissionStatus.BUDGET_EXHAUSTED)
    assert await small.bucket_usage(bucket) == PendingUsage(BUCKET_BUDGET, 4)
    assert await valkey().exists(buffer_keys(late.scope, env.namespace).stream) == 0


async def test_disabled_preflight_refuses_admission_as_retryable(env) -> None:
    head = await establish(env)
    async with buffering_disabled():
        with pytest.raises(BufferUnavailable):
            await offer(env, head, "u-1", edit(env.base, " refused"))

    assert await valkey().exists(buffer_keys(head.scope, env.namespace).stream) == 0


async def test_timeout_after_append_raises_unknown_and_retry_returns_the_same_sequence(
    env, proxied
) -> None:
    proxy, client = proxied
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)
    first, second = edit(env.base, " Alice"), edit(env.base, " Bob")
    through_proxy = UpdateBuffer(namespace=env.namespace, pending_budget_bytes=BUDGET, client=client)
    await offer(env, head, "u-1", first)
    assert await client.ping() is True

    proxy.dropping = True
    with pytest.raises(AdmissionUnknown) as unknown:
        await offer(env, head, "u-2", second, buffer=through_proxy)

    assert unknown.value.update_id == "u-2"
    entries = await valkey().xrange(keys.stream)
    assert [entry_id for entry_id, _ in entries] == [b"1-0", b"2-0"]
    stored = await env.buffer.read_updates(head.scope, after=0, through=2)
    assert [record.update for record in stored] == [first, second]
    retried = await offer(env, head, "u-2", second)
    assert retried == AdmissionOutcome(AdmissionStatus.DUPLICATE, receipt(head, 2, "u-2"))


async def test_trim_through_a_committed_sequence_keeps_the_newer_tail_due_from_its_oldest_record(
    env,
) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)
    payloads = [edit(env.base, name) for name in (" Alice", " Bob", " Carol")]
    for index, payload in enumerate(payloads, start=1):
        await offer(env, head, f"u-{index}", payload)
    window = await valkey().zscore(keys.due, head.scope.member)
    carol = (await valkey().xrange(keys.stream, min="3-0", max="3-0"))[0][1]

    partial = await env.buffer.trim_committed(head.scope, 2)

    assert partial == TrimResult(
        stored_bytes("u-1", payloads[0]) + stored_bytes("u-2", payloads[1]), 2, 1
    )
    assert [entry_id for entry_id, _ in await valkey().xrange(keys.stream)] == [b"3-0"]
    assert set(await valkey().hkeys(keys.receipts)) == {b"u-3"}
    # The survivor waits ten seconds from its own acceptance, not from the trimmed window.
    accepted = int(carol[b"t"])
    assert await valkey().zscore(keys.due, head.scope.member) == accepted + DUE_DELAY_MS >= window
    assert await valkey().hget(keys.control, "first_ms") == str(accepted).encode()
    assert await env.buffer.bucket_usage(head.scope.bucket) == PendingUsage(
        stored_bytes("u-3", payloads[2]), 1
    )

    complete = await env.buffer.trim_committed(head.scope, 3)

    assert complete == TrimResult(stored_bytes("u-3", payloads[2]), 1, 0)
    assert await valkey().zscore(keys.due, head.scope.member) is None
    assert await valkey().hget(keys.control, "first_ms") is None
    assert await valkey().hget(keys.control, "head") == b"3"
    assert await env.buffer.organization_usage(head.scope.bucket, env.org) == 0


async def test_accounting_repair_recomputes_counters_from_the_streams(env) -> None:
    heads = [await establish(env, key) for key in env.keys]
    sizes: dict[int, PendingUsage] = {}
    for position, (head, base) in enumerate(zip(heads, env.bases, strict=True)):
        for index in range(position + 2):
            await offer(env, head, f"u-{index}", edit(base, f" {position}-{index}"))
    victim = buffer_keys(heads[0].scope, env.namespace)
    removed = (await valkey().xrange(victim.stream, count=1))[0]
    await valkey().xdel(victim.stream, removed[0])
    await valkey().hset(buffer_keys(heads[1].scope, env.namespace).control, "bytes", 1)
    for head in heads:
        accounting = accounting_key(head.scope.bucket, env.namespace)
        await valkey().hset(
            accounting, mapping={"bytes": 999_999, f"o:{env.org}": 999_999, f"o:{uuid4()}": 5}
        )
    for head in heads:
        entries = await valkey().xrange(buffer_keys(head.scope, env.namespace).stream)
        current = sizes.get(head.scope.bucket, PendingUsage(0, 0))
        sizes[head.scope.bucket] = PendingUsage(
            current.bytes + stored_cost(entries), current.records + len(entries)
        )

    repaired = {bucket: await env.buffer.repair_accounting(bucket) for bucket in sizes}

    assert repaired == sizes
    for bucket, usage in sizes.items():
        assert await env.buffer.bucket_usage(bucket) == usage
        assert await env.buffer.organization_usage(bucket, env.org) == usage.bytes
        fields = await valkey().hkeys(accounting_key(bucket, env.namespace))
        assert {field for field in fields if field.startswith(b"o:")} == {f"o:{env.org}".encode()}
    for head in heads:
        keys = buffer_keys(head.scope, env.namespace)
        entries = await valkey().xrange(keys.stream)
        control = await valkey().hgetall(keys.control)
        assert int(control[b"bytes"]) == stored_cost(entries)
        assert int(control[b"records"]) == len(entries)


async def test_a_buffered_record_rests_sealed_and_reads_back_as_plaintext(env) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)
    typed = " quarterly numbers"
    payload = edit(env.base, typed)

    outcome = await offer(env, head, "u-1", payload)

    ((_, fields),) = await valkey().xrange(keys.stream)
    assert fields[b"v"] == b"2"
    assert typed.encode() not in fields[b"u"]
    assert fields[b"u"] == outcome.sealed
    assert fields[b"u"][0] == 0x01
    assert len(fields[b"u"]) == len(payload) + SEAL_OVERHEAD_BYTES
    (record,) = await env.buffer.read_updates(head.scope, after=0, through=1)
    assert record.update == payload


async def test_a_record_rewritten_to_another_actor_reads_back_as_malformed(env) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)
    await offer(env, head, "u-1", edit(env.base, " kept"))
    await offer(env, head, "u-2", edit(env.base, " forged"))
    entries = await valkey().xrange(keys.stream)
    # A stream entry cannot change in place, so the stream is rebuilt under the same ids.
    await valkey().delete(keys.stream)
    for entry_id, fields in entries:
        actor = str(env.bob).encode() if entry_id == b"2-0" else fields[b"a"]
        await valkey().xadd(keys.stream, {**fields, b"a": actor}, id=entry_id)
    failures = gauge("uniffy_realtime_buffer_unseal_failures_total", {"source": "stream"})

    kept, broken = await env.buffer.read_prefix(head.scope, 0, 2)

    assert broken is RecoveryReason.MALFORMED
    assert [record.seq for record in kept] == [1]
    assert gauge("uniffy_realtime_buffer_unseal_failures_total", {"source": "stream"}) == (
        failures + 1
    )
