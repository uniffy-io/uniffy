"""The realtime update buffer without Valkey: key layout, arguments, sealing and merging."""

import os
from types import SimpleNamespace
from typing import Any, cast
from uuid import UUID, uuid4

import pycrdt
import pytest
from prometheus_client import REGISTRY

from uniffy.core.crypto import SEAL_OVERHEAD_BYTES, OrgDataCipher, StaticKeySource
from uniffy.core.realtime import buffer as buffer_module
from uniffy.core.realtime.buffer import BufferUnavailable, RecoveryReason, UpdateBuffer
from uniffy.core.realtime.buffer_keys import (
    BUCKET_COUNT,
    RECORD_FORMAT,
    RECORD_OVERHEAD_BYTES,
    AdmissionOutcome,
    AdmissionStatus,
    BufferedUpdate,
    BufferHead,
    BufferScope,
    Receipt,
    accounting_key,
    bucket_for,
    buffer_keys,
    due_key,
    early_key,
    merge_tail,
    parse_member,
    parse_record,
    record_aad,
    scopes_key,
    stored_bytes,
    validate_update,
)
from uniffy.core.realtime.limits import MAX_FRAME_BYTES
from uniffy.core.realtime.markdown import markdown_text
from uniffy.core.realtime.preflight import PreflightVerdict
from uniffy.core.realtime.wire import MAX_WIRE_STRING_BYTES
from uniffy.core.types import ContentType, generate_id

ORGANIZATION = UUID("0192f0c4-7a1e-7c55-9d5e-4c1f9a0b2d31")
CONTENT = UUID("0192f0c4-7a1e-7c55-9d5e-4c1f9a0b2d32")
GENERATION = "6f1d2c9e-5b0a-4d7e-8f3c-2a1b0c9d8e7f"
EPOCH = "1c2b3a49-5867-4f3e-9d2c-1b0a9f8e7d6c"


def scope(**overrides: Any) -> BufferScope:
    fields: dict[str, Any] = {
        "organization_id": ORGANIZATION,
        "content_type": ContentType.NOTE,
        "content_id": CONTENT,
        "generation": GENERATION,
        "epoch": EPOCH,
    }
    fields.update(overrides)
    return BufferScope(**fields)


def hash_tag(key: str) -> str:
    return key[key.index("{") : key.index("}") + 1]


def test_bucket_is_stable_for_a_document_across_generations_and_epochs() -> None:
    first = scope()
    later = scope(generation="", epoch=str(uuid4()))

    assert first.bucket == later.bucket == bucket_for(ORGANIZATION, ContentType.NOTE, CONTENT)
    assert 0 <= first.bucket < BUCKET_COUNT


def test_bucket_depends_on_tenant_type_and_id() -> None:
    buckets = {
        bucket_for(uuid4(), content_type, uuid4())
        for content_type in (ContentType.NOTE, ContentType.TASK, ContentType.CALENDAR_EVENT)
        for _ in range(200)
    }

    assert buckets == set(range(BUCKET_COUNT))


def test_every_key_of_a_document_shares_its_bucket_hash_tag() -> None:
    keys = buffer_keys(scope(), "test:ns:")
    tags = {
        hash_tag(key)
        for key in (
            keys.stream,
            keys.control,
            keys.receipts,
            keys.due,
            keys.accounting,
            keys.early,
            keys.scopes,
        )
    }

    assert tags == {hash_tag(due_key(scope().bucket))}
    assert keys.due == due_key(scope().bucket, "test:ns:")
    assert keys.accounting == accounting_key(scope().bucket, "test:ns:")
    assert keys.early == early_key(scope().bucket, "test:ns:")
    assert keys.scopes == scopes_key(scope().bucket, "test:ns:")
    assert all(key.startswith("test:ns:") for key in (keys.stream, keys.control, keys.receipts))


def test_buckets_use_distinct_hash_tags() -> None:
    assert len({hash_tag(due_key(bucket)) for bucket in range(BUCKET_COUNT)}) == BUCKET_COUNT


def test_document_keys_carry_tenant_type_id_generation_and_epoch() -> None:
    keys = buffer_keys(scope())
    other_epoch = buffer_keys(scope(epoch=str(uuid4())))
    other_generation = buffer_keys(scope(generation=str(uuid4())))
    other_tenant = buffer_keys(scope(organization_id=uuid4()))

    for key in (keys.stream, keys.control, keys.receipts):
        for part in (str(ORGANIZATION), ContentType.NOTE.value, str(CONTENT), GENERATION, EPOCH):
            assert part in key
    assert len({keys.stream, keys.control, keys.receipts}) == 3
    for other in (other_epoch, other_generation, other_tenant):
        assert {other.stream, other.control, other.receipts}.isdisjoint({
            keys.stream,
            keys.control,
            keys.receipts,
        })


@pytest.mark.parametrize("generation", [GENERATION, ""])
def test_due_member_names_its_scope(generation: str) -> None:
    original = scope(generation=generation)

    assert parse_member(original.member) == original
    assert parse_member(original.member.encode()) == original


def test_a_record_counts_its_sealed_bytes_its_id_twice_and_the_entry_overhead() -> None:
    assert stored_bytes("u-1", b"x" * 24) == 24 + SEAL_OVERHEAD_BYTES + 2 * 3 + RECORD_OVERHEAD_BYTES
    # Ids count in UTF-8 bytes, as Valkey stores them.
    assert stored_bytes("\u00e9", b"x") == 1 + SEAL_OVERHEAD_BYTES + 2 * 2 + RECORD_OVERHEAD_BYTES


@pytest.mark.parametrize(
    "overrides",
    [
        {"epoch": ""},
        {"epoch": "a:b"},
        {"generation": "{tag}"},
        {"generation": "x" * (MAX_WIRE_STRING_BYTES + 1)},
        {"content_type": "NOTE"},
        {"organization_id": str(ORGANIZATION)},
    ],
)
def test_scope_refuses_segments_that_would_break_the_key_layout(overrides: dict) -> None:
    with pytest.raises(ValueError):
        scope(**overrides)


@pytest.mark.parametrize("member", ["", "a:b:c:d", f"{ORGANIZATION}:NOPE:{CONTENT}:g:e"])
def test_malformed_due_member_is_refused(member: str) -> None:
    with pytest.raises(ValueError):
        parse_member(member)


@pytest.mark.parametrize("namespace", ["test:{x}:", "test:*:", "test:[a]:"])
def test_namespace_with_hash_tag_or_glob_characters_is_refused(namespace: str) -> None:
    with pytest.raises(ValueError):
        UpdateBuffer(namespace=namespace)


@pytest.mark.parametrize(
    ("update_id", "update"),
    [
        ("", b"u"),
        ("x" * (MAX_WIRE_STRING_BYTES + 1), b"u"),
        ("é" * (MAX_WIRE_STRING_BYTES // 2 + 1), b"u"),
        ("\ud800", b"u"),
        ("id", b""),
        ("id", b"u" * (MAX_FRAME_BYTES + 1)),
        (cast(Any, 7), b"u"),
        ("id", cast(Any, "text")),
    ],
)
def test_update_arguments_outside_the_contract_are_refused(update_id: str, update: bytes) -> None:
    with pytest.raises(ValueError):
        validate_update(update_id, update)


def test_update_arguments_at_the_bounds_are_accepted() -> None:
    validate_update("x" * MAX_WIRE_STRING_BYTES, b"u" * MAX_FRAME_BYTES)
    validate_update("é" * (MAX_WIRE_STRING_BYTES // 2), b"u")


def record(seq: int, update: bytes) -> BufferedUpdate:
    return BufferedUpdate(seq, f"u-{seq}", update, ORGANIZATION, 0)


def text_of(update: bytes) -> str:
    doc = pycrdt.Doc()
    doc.apply_update(update)
    return str(markdown_text(doc))


def test_merged_tail_keeps_a_successor_until_its_predecessor_arrives() -> None:
    doc = pycrdt.Doc()
    markdown_text(doc).insert(0, "base")
    checkpoint = doc.get_update()
    before = doc.get_state()
    markdown_text(doc).insert(4, " one")
    predecessor = doc.get_update(before)
    middle = doc.get_state()
    markdown_text(doc).insert(8, " two")
    successor = doc.get_update(middle)

    early = merge_tail(checkpoint, [record(1, successor)])
    complete = merge_tail(early, [record(2, predecessor)])

    assert text_of(early) == "base"
    assert text_of(complete) == "base one two"


def test_merged_tail_keeps_a_delete_only_update() -> None:
    doc = pycrdt.Doc()
    markdown_text(doc).insert(0, "base text")
    checkpoint = doc.get_update()
    before = doc.get_state()
    del markdown_text(doc)[4:9]
    deletion = doc.get_update(before)

    assert doc.get_state() == before
    assert text_of(merge_tail(checkpoint, [record(1, deletion)])) == "base"
    assert merge_tail(checkpoint, []) == checkpoint


RUN_ID = "565deefd1b36dff07a7d63be7f9b8352d97885ec"
ACTOR = UUID("0192f0c4-7a1e-7c55-9d5e-4c1f9a0b2d33")


class FakeConnection:
    async def initialize(self) -> None:
        return None

    async def aclose(self) -> None:
        return None


class FakeValkey:
    """Hands admission a connection and serves XRANGE from fixed stream entries."""

    def __init__(self) -> None:
        self.entries: list[tuple[bytes, dict[bytes, bytes]]] = []

    def client(self) -> FakeConnection:
        return FakeConnection()

    async def xrange(self, _stream: str, **bounds: Any) -> list[tuple[bytes, dict[bytes, bytes]]]:
        low = int(bounds["min"].partition("-")[0])
        high = None if bounds["max"] == "+" else int(bounds["max"].partition("-")[0])

        def within(entry_id: bytes) -> bool:
            seq = int(entry_id.partition(b"-")[0])
            return seq >= low and (high is None or seq <= high)

        return [entry for entry in self.entries if within(entry[0])][: bounds["count"]]


class AdmitScript:
    """Stands in for the admission script: records its arguments and answers in turn."""

    def __init__(self) -> None:
        self.calls: list[list[Any]] = []
        self.replies: list[list[bytes | int]] = []

    async def __call__(self, _client: Any, _script: Any, _keys: Any, args: list[Any]) -> Any:
        self.calls.append(list(args))
        return self.replies.pop(0)


@pytest.fixture
def admit_script(monkeypatch: pytest.MonkeyPatch) -> AdmitScript:
    script = AdmitScript()

    async def ready() -> None:
        return None

    monkeypatch.setattr(buffer_module, "ensure_buffer_ready", ready)
    monkeypatch.setattr(
        buffer_module,
        "preflight_result",
        lambda: SimpleNamespace(verdict=PreflightVerdict.ENABLED, pending_budget_bytes=1 << 30),
    )
    monkeypatch.setattr(buffer_module, "server_identity", lambda: SimpleNamespace(run_id=RUN_ID))
    monkeypatch.setattr(buffer_module, "run_script", script)
    return script


def sealing_buffer(organization: UUID) -> tuple[UpdateBuffer, OrgDataCipher, FakeValkey]:
    cipher = OrgDataCipher(StaticKeySource({organization: (1, os.urandom(32))}))
    valkey = FakeValkey()
    buffer = UpdateBuffer(pending_budget_bytes=1 << 30, client=cast(Any, valkey), cipher=cipher)
    return buffer, cipher, valkey


def head_of(organization: UUID) -> BufferHead:
    return BufferHead(scope(organization_id=organization), 0, 0, 1, RUN_ID)


async def test_admission_hands_the_script_a_sealed_record_and_a_keyed_digest(
    admit_script: AdmitScript,
) -> None:
    organization = generate_id()
    buffer, cipher, _ = sealing_buffer(organization)
    head = head_of(organization)
    admit_script.replies.append([b"accepted", 1])

    outcome = await buffer.admit(head, update_id="u-1", update=b"typed text", actor_id=ACTOR)

    (args,) = admit_script.calls
    sealed, digest = args[1], args[2]
    assert outcome == AdmissionOutcome(
        AdmissionStatus.ACCEPTED, Receipt(GENERATION, EPOCH, 1, "u-1")
    )
    assert outcome.sealed == sealed
    assert b"typed text" not in sealed
    assert len(sealed) == len(b"typed text") + SEAL_OVERHEAD_BYTES
    aad = record_aad(head.scope, "u-1", ACTOR)
    assert await cipher.unseal(organization, sealed, aad=aad) == b"typed text"
    assert digest == await cipher.receipt_digest(organization, b"typed text")
    # A full frame still fits once sealed.
    assert args[10] == MAX_FRAME_BYTES + SEAL_OVERHEAD_BYTES
    assert args[12] == RECORD_FORMAT == 2


async def test_a_duplicate_carries_its_seal_and_a_refusal_carries_none(
    admit_script: AdmitScript,
) -> None:
    organization = generate_id()
    buffer, _, _ = sealing_buffer(organization)
    head = head_of(organization)
    admit_script.replies += [[b"duplicate", 4], [b"id_conflict"]]

    duplicate = await buffer.admit(head, update_id="u-1", update=b"typed", actor_id=ACTOR)
    conflict = await buffer.admit(head, update_id="u-1", update=b"other", actor_id=ACTOR)

    assert duplicate.status is AdmissionStatus.DUPLICATE
    assert duplicate.sealed == admit_script.calls[0][1]
    assert conflict == AdmissionOutcome(AdmissionStatus.ID_CONFLICT)
    assert conflict.sealed is None


async def test_admission_without_an_organization_key_is_retryable_and_reaches_no_valkey(
    admit_script: AdmitScript,
) -> None:
    buffer, _, _ = sealing_buffer(generate_id())

    with pytest.raises(BufferUnavailable):
        await buffer.admit(head_of(generate_id()), update_id="u-1", update=b"x", actor_id=ACTOR)

    assert admit_script.calls == []


async def sealed_entry(
    cipher: OrgDataCipher, head: BufferHead, seq: int, update: bytes, actor: UUID = ACTOR
) -> tuple[bytes, dict[bytes, bytes]]:
    update_id = f"u-{seq}"
    sealed = await cipher.seal(
        head.scope.organization_id, update, aad=record_aad(head.scope, update_id, actor)
    )
    fields = {
        b"i": update_id.encode(),
        b"u": sealed,
        b"a": str(actor).encode(),
        b"t": b"1",
        b"v": str(RECORD_FORMAT).encode(),
    }
    return f"{seq}-0".encode(), fields


def unseal_failures() -> float:
    labels = {"source": "stream"}
    return REGISTRY.get_sample_value("uniffy_realtime_buffer_unseal_failures_total", labels) or 0


async def test_reads_hand_out_plaintext_and_stop_at_a_record_that_does_not_unseal() -> None:
    organization = generate_id()
    buffer, cipher, valkey = sealing_buffer(organization)
    head = head_of(organization)
    first = await sealed_entry(cipher, head, 1, b"first")
    _, moved = await sealed_entry(cipher, head, 2, b"second")
    # The second record claims another actor than the one it was sealed for.
    valkey.entries = [first, (b"2-0", {**moved, b"a": str(uuid4()).encode()})]
    failures = unseal_failures()

    updates, broken = await buffer.read_prefix(head.scope, 0, 2)

    assert [(record.seq, record.update) for record in updates] == [(1, b"first")]
    assert broken is RecoveryReason.MALFORMED
    assert unseal_failures() == failures + 1


async def test_a_record_read_under_another_epoch_does_not_unseal() -> None:
    organization = generate_id()
    buffer, cipher, valkey = sealing_buffer(organization)
    head = head_of(organization)
    valkey.entries = [await sealed_entry(cipher, head, 1, b"first")]

    updates, broken = await buffer.read_prefix(scope(organization_id=organization, epoch="e2"), 0, 1)

    assert updates == ()
    assert broken is RecoveryReason.MALFORMED


async def test_parsing_keeps_the_sealed_bytes_and_refuses_other_record_formats() -> None:
    organization = generate_id()
    _, cipher, _ = sealing_buffer(organization)
    entry_id, fields = await sealed_entry(cipher, head_of(organization), 1, b"first")

    parsed = parse_record(entry_id, fields)

    assert parsed is not None
    assert parsed.update == fields[b"u"]
    assert parse_record(entry_id, {**fields, b"v": b"1"}) is None
