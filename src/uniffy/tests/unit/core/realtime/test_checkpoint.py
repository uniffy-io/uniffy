from dataclasses import replace

import pycrdt
import pytest

from uniffy.core.realtime.buffer_keys import BufferedUpdate, BufferScope
from uniffy.core.realtime.checkpoint import (
    CAPTURE_MAX_BYTES,
    CAPTURE_MAX_RECORDS,
    capture_prefix,
    compact_checkpoint,
)
from uniffy.core.realtime.dispatch import (
    BACKOFF_BASE_SECONDS,
    BACKOFF_MAX_SECONDS,
    backoff_seconds,
    checkpoint_job_id,
)
from uniffy.core.realtime.markdown import markdown_text
from uniffy.core.types import ContentType, generate_id

ACTOR = generate_id()


def record(seq: int, update: bytes) -> BufferedUpdate:
    return BufferedUpdate(seq, f"u-{seq}", update, ACTOR, 0)


def text_of(update: bytes) -> str:
    doc = pycrdt.Doc()
    doc.apply_update(update)
    return str(markdown_text(doc))


def test_capture_stops_at_the_record_bound() -> None:
    tail = [record(seq, b"x") for seq in range(1, CAPTURE_MAX_RECORDS + 3)]

    assert capture_prefix(tail) == tuple(tail[:CAPTURE_MAX_RECORDS])


def test_capture_stops_before_the_record_that_crosses_the_byte_bound() -> None:
    half = CAPTURE_MAX_BYTES // 2
    tail = [record(1, b"a" * half), record(2, b"b" * half), record(3, b"c")]

    assert capture_prefix(tail) == tuple(tail[:2])


def test_capture_takes_a_single_record_above_the_byte_bound_alone() -> None:
    tail = [record(1, b"a" * (CAPTURE_MAX_BYTES + 1)), record(2, b"b")]

    assert capture_prefix(tail) == (tail[0],)


def test_compaction_keeps_a_successor_whose_predecessor_has_not_arrived() -> None:
    doc = pycrdt.Doc()
    markdown_text(doc).insert(0, "base")
    checkpoint = doc.get_update()
    before = doc.get_state()
    markdown_text(doc).insert(4, " first")
    predecessor = doc.get_update(before)
    before = doc.get_state()
    markdown_text(doc).insert(10, " second")
    successor = doc.get_update(before)

    compacted, _ = compact_checkpoint(checkpoint, [record(1, successor)])
    later = pycrdt.Doc()
    later.apply_update(compacted)
    later.apply_update(predecessor)

    assert text_of(compacted) == "base"
    assert str(markdown_text(later)) == "base first second"


def test_compaction_applies_a_delete_only_update_and_collects_the_deleted_text() -> None:
    doc = pycrdt.Doc()
    markdown_text(doc).insert(0, "base " + "z" * 10_000)
    checkpoint = doc.get_update()
    before = doc.get_state()
    del markdown_text(doc)[4:]
    deletion = doc.get_update(before)

    compacted, state_vector = compact_checkpoint(checkpoint, [record(1, deletion)])

    assert text_of(compacted) == "base"
    assert len(compacted) < len(checkpoint) // 10
    assert state_vector == doc.get_state()


def test_compaction_refuses_an_undecodable_record() -> None:
    doc = pycrdt.Doc()
    markdown_text(doc).insert(0, "base")

    with pytest.raises(ValueError):
        compact_checkpoint(doc.get_update(), [record(1, b"not a yjs update")])


def test_job_ids_differ_for_every_dispatch_and_epoch() -> None:
    scope = BufferScope(generate_id(), ContentType.NOTE, generate_id(), "generation", "epoch-a")
    next_epoch = replace(scope, epoch="epoch-b")

    ids = {
        checkpoint_job_id(scope, "claim-1"),
        checkpoint_job_id(scope, "claim-2"),
        checkpoint_job_id(next_epoch, "claim-1"),
    }

    assert len(ids) == 3


def test_backoff_doubles_per_failure_up_to_the_cap() -> None:
    delays = [backoff_seconds(failures) for failures in range(1, 12)]

    assert delays[:3] == [BACKOFF_BASE_SECONDS, 2 * BACKOFF_BASE_SECONDS, 4 * BACKOFF_BASE_SECONDS]
    assert delays == sorted(delays)
    assert delays[-1] == BACKOFF_MAX_SECONDS
