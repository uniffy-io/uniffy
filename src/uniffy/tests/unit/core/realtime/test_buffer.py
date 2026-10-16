"""Pure parts of the realtime update buffer: key layout, bucket mapping, arguments and merging."""

from fnmatch import fnmatchcase
from typing import Any, cast
from uuid import UUID, uuid4

import pycrdt
import pytest

from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.buffer_keys import (
    BUCKET_COUNT,
    BufferedUpdate,
    BufferScope,
    KeyKind,
    accounting_key,
    bucket_for,
    buffer_keys,
    due_key,
    key_pattern,
    merge_tail,
    parse_member,
    scope_of_key,
    scopes_of_keys,
    validate_update,
)
from uniffy.core.realtime.limits import MAX_FRAME_BYTES
from uniffy.core.realtime.markdown import markdown_text
from uniffy.core.realtime.wire import MAX_WIRE_STRING_BYTES
from uniffy.core.types import ContentType

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
        for key in (keys.stream, keys.control, keys.receipts, keys.due, keys.accounting)
    }

    assert tags == {hash_tag(due_key(scope().bucket))}
    assert keys.due == due_key(scope().bucket, "test:ns:")
    assert keys.accounting == accounting_key(scope().bucket, "test:ns:")
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
def test_due_member_and_document_keys_name_their_scope(generation: str) -> None:
    original = scope(generation=generation)
    keys = buffer_keys(original, "ns:")

    assert parse_member(original.member) == original
    assert parse_member(original.member.encode()) == original
    assert scope_of_key(keys.stream, KeyKind.STREAM, "ns:") == original
    assert scope_of_key(keys.control.encode(), KeyKind.CONTROL, "ns:") == original


@pytest.mark.parametrize(
    ("kind", "namespace"),
    [(KeyKind.STREAM, "ns:"), (KeyKind.RECEIPTS, "ns:"), (KeyKind.CONTROL, "other:")],
)
def test_a_key_of_another_kind_or_namespace_names_no_scope(kind: KeyKind, namespace: str) -> None:
    control = buffer_keys(scope(), "ns:").control

    with pytest.raises(ValueError):
        scope_of_key(control, kind, namespace)


def test_scopes_of_keys_collects_each_document_once_and_skips_other_buffer_keys() -> None:
    first, second = scope(), scope(epoch=str(uuid4()))
    keys = buffer_keys(first, "ns:")
    found = [
        keys.stream,
        keys.control,
        keys.receipts,
        buffer_keys(second, "ns:").control,
        buffer_keys(scope(content_id=uuid4()), "other:").stream,
        due_key(first.bucket, "ns:"),
        accounting_key(first.bucket, "ns:"),
        f"{keys.control}:trailing",
    ]

    scopes = scopes_of_keys(found, (KeyKind.STREAM, KeyKind.CONTROL), "ns:")

    assert scopes == sorted([first, second], key=lambda item: item.member)


def test_key_patterns_match_one_kind_or_every_buffer_key() -> None:
    keys = buffer_keys(scope(), "ns:")
    bucket = scope().bucket

    assert fnmatchcase(keys.stream, key_pattern(KeyKind.STREAM, "ns:"))
    assert fnmatchcase(keys.stream, key_pattern(KeyKind.STREAM, "ns:", bucket))
    assert not fnmatchcase(keys.control, key_pattern(KeyKind.STREAM, "ns:"))
    assert not fnmatchcase(
        keys.stream, key_pattern(KeyKind.STREAM, "ns:", (bucket + 1) % BUCKET_COUNT)
    )
    assert all(
        fnmatchcase(key, key_pattern(None, "ns:"))
        for key in (keys.stream, keys.control, keys.receipts, keys.due, keys.accounting)
    )
    assert not fnmatchcase(keys.stream, key_pattern(None, "other:"))


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
