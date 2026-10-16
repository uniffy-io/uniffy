from uuid import UUID

import pycrdt
import pytest

from uniffy.core.realtime import resident as resident_module
from uniffy.core.realtime.buffer_keys import BufferedUpdate, BufferHead, BufferScope, LatestState
from uniffy.core.realtime.markdown import (
    DOC_GENERATION_KEY,
    DOC_META_FIELD,
    MARKDOWN_MIRROR_FIELD,
    markdown_text,
)
from uniffy.core.realtime.resident import (
    Continuity,
    check_update,
    follow,
    follow_record,
    session_state_message,
)
from uniffy.core.realtime.state import YDocSession
from uniffy.core.realtime.storage import DocumentTooLarge, GenerationConflict, SeedConflict
from uniffy.core.realtime.wire import (
    SessionState,
    YMessageType,
    YSyncMessageType,
    handle_sync_message,
    parse_generation_message,
    parse_session_state_message,
)
from uniffy.core.types import ContentType, generate_id

GENERATION = "3f9c1a52-7d4e-4b8a-9c61-0e2f5d8b7a14"
ORGANIZATION = generate_id()
NOTE = generate_id()
ACTOR = generate_id()


def baseline(text: str = "base", generation: str = GENERATION) -> bytes:
    doc = pycrdt.Doc()
    doc.get(DOC_META_FIELD, type=pycrdt.Map)[DOC_GENERATION_KEY] = generation
    markdown_text(doc).insert(0, text)
    return doc.get_update()


def decoded(*updates: bytes) -> pycrdt.Doc:
    doc = pycrdt.Doc()
    for update in updates:
        doc.apply_update(update)
    return doc


def text_of(doc: pycrdt.Doc) -> str:
    return str(markdown_text(doc))


def typed(*history: bytes, suffix: str) -> bytes:
    doc = decoded(*history)
    before = doc.get_state()
    text = markdown_text(doc)
    text.insert(len(str(text)), suffix)
    return doc.get_update(before)


def latest(
    checkpoint: bytes,
    *updates: bytes,
    epoch: str = "epoch-1",
    generation: str = GENERATION,
    checkpoint_seq: int = 0,
    revision: int = 1,
) -> LatestState:
    tail = tuple(
        BufferedUpdate(checkpoint_seq + index, f"update-{index}", update, ACTOR, 0)
        for index, update in enumerate(updates, start=1)
    )
    scope = BufferScope(ORGANIZATION, ContentType.NOTE, NOTE, generation, epoch)
    head = BufferHead(scope, checkpoint_seq + len(tail), checkpoint_seq, revision, "run")
    return LatestState(head, checkpoint, tail)


def resident(state: LatestState) -> YDocSession:
    session = YDocSession(
        key=(ContentType.NOTE, NOTE), ydoc=pycrdt.Doc(), organization_id=ORGANIZATION
    )
    follow(session, state)
    return session


def kind(frame: bytes) -> tuple[int, int | None]:
    return frame[0], frame[1] if frame[0] == YMessageType.SYNC else None


def applied(peer: pycrdt.Doc, frame: bytes) -> pycrdt.Doc:
    handle_sync_message(frame[1:], peer)
    return peer


def test_follow_within_epoch_sends_only_records_beyond_the_resident_head() -> None:
    base = baseline()
    first = typed(base, suffix=" one")
    second = typed(base, first, suffix=" two")
    session = resident(latest(base, first))
    peer = decoded(base, first)

    frames = follow(session, latest(base, first, second))

    assert [kind(frame) for frame in frames] == [(YMessageType.SYNC, YSyncMessageType.SYNC_UPDATE)]
    assert text_of(applied(peer, frames[0])) == "base one two"
    assert text_of(session.ydoc) == "base one two"
    assert session.head_seq == 2
    assert follow(session, latest(base, first, second)) == []


def test_follow_into_a_new_epoch_drops_lost_edits_and_requests_reconciliation() -> None:
    base = baseline()
    kept = typed(base, suffix=" kept")
    lost = typed(base, kept, suffix=" lost")
    session = resident(latest(base, kept, lost))
    authority = pycrdt.merge_updates(base, kept)

    frames = follow(session, latest(authority, epoch="epoch-2", revision=2))

    assert [kind(frame) for frame in frames] == [
        (13, None),
        (YMessageType.SYNC, YSyncMessageType.SYNC_STEP1),
    ]
    assert parse_session_state_message(frames[0]) == SessionState(GENERATION, "epoch-2", 0, 0, 2)
    assert text_of(session.ydoc) == "base kept"


def test_follow_into_a_new_generation_replaces_the_document() -> None:
    session = resident(latest(baseline()))
    replacement = baseline("replaced", generation="0193a6c2-5b7e-7f10-8d42-6a9e3c1b2f75")

    frames = follow(
        session,
        latest(replacement, generation="0193a6c2-5b7e-7f10-8d42-6a9e3c1b2f75", epoch="epoch-9"),
    )

    assert [kind(frame) for frame in frames] == [
        (5, None),
        (13, None),
        (YMessageType.SYNC, YSyncMessageType.SYNC_UPDATE),
    ]
    assert parse_generation_message(frames[0]) == "0193a6c2-5b7e-7f10-8d42-6a9e3c1b2f75"
    assert text_of(applied(pycrdt.Doc(), frames[2])) == "replaced"
    assert text_of(session.ydoc) == "replaced"


def test_new_checkpoint_sends_only_missing_inserts_and_deletes() -> None:
    base = baseline("x" * 32000)
    session = resident(latest(base))
    peer = decoded(base)
    writer = decoded(base)
    markdown_text(writer).insert(16000, "new")

    frames = follow(session, latest(writer.get_update(), revision=2))

    assert len(frames) == 1 and len(frames[0]) < 200
    assert text_of(applied(peer, frames[0])) == "x" * 16000 + "new" + "x" * 16000
    assert follow(session, latest(writer.get_update(), revision=2)) == []
    del markdown_text(writer)[:1]
    frames = follow(session, latest(writer.get_update(), revision=3))
    assert text_of(applied(peer, frames[0])) == "x" * 15999 + "new" + "x" * 16000


def deleted(*history: bytes, count: int = 1) -> bytes:
    doc = decoded(*history)
    before = doc.get_state()
    del markdown_text(doc)[:count]
    return doc.get_update(before)


def test_checkpoint_that_only_repeats_known_deletions_sends_nothing() -> None:
    base = baseline()
    trimmed = pycrdt.merge_updates(base, deleted(base))
    session = resident(latest(trimmed))

    assert follow(session, latest(trimmed, revision=2)) == []
    assert [kind(frame) for frame in follow(session, latest(trimmed, epoch="epoch-2"))] == [
        (13, None),
        (YMessageType.SYNC, YSyncMessageType.SYNC_STEP1),
    ]
    frames = follow(session, latest(trimmed, deleted(trimmed), epoch="epoch-2"))
    assert [kind(frame) for frame in frames] == [(YMessageType.SYNC, YSyncMessageType.SYNC_UPDATE)]
    assert text_of(applied(decoded(trimmed), frames[0])) == "se"


def test_sync_reply_with_only_known_deletions_adds_nothing() -> None:
    base = baseline()
    trimmed = pycrdt.merge_updates(base, deleted(base))
    session = resident(latest(trimmed))
    client = decoded(trimmed)
    writer = decoded(trimmed)
    markdown_text(writer).insert(3, " one")
    middle = writer.get_state()
    markdown_text(writer).insert(7, " two")
    # The writer's earlier struct never arrived, so a decoded document would not show this one.
    second = writer.get_update(middle)

    assert check_update(session, GENERATION, client.get_update(session.ydoc.get_state())) is False
    assert check_update(session, GENERATION, trimmed) is False
    assert check_update(session, GENERATION, deleted(trimmed)) is True
    assert check_update(session, GENERATION, second) is True
    assert text_of(session.ydoc) == "ase"


def test_a_record_applies_only_when_it_continues_the_head() -> None:
    base = baseline()
    first = typed(base, suffix=" one")
    second = typed(base, first, suffix=" two")
    session = resident(latest(base, first))

    assert follow_record(session, GENERATION, "epoch-1", 3, b"\x00\x00") is Continuity.GAP
    assert follow_record(session, GENERATION, "epoch-0", 2, second) is Continuity.GAP
    assert follow_record(session, GENERATION, "epoch-1", 2, second) is Continuity.APPLIED
    assert follow_record(session, GENERATION, "epoch-1", 2, second) is Continuity.KNOWN
    assert text_of(session.ydoc) == "base one two"
    assert session.head_seq == 2


def test_refused_updates_leave_the_resident_document_untouched(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    base = baseline()
    session = resident(latest(base))
    claim = decoded(base)
    before = claim.get_state()
    claim.get(MARKDOWN_MIRROR_FIELD, type=pycrdt.Map)["seeded_by:client"] = [0]
    renamed = decoded(base)
    before_rename = renamed.get_state()
    renamed.get(DOC_META_FIELD, type=pycrdt.Map)[DOC_GENERATION_KEY] = "other"

    with pytest.raises(GenerationConflict):
        check_update(session, "stale", typed(base, suffix=" late"))
    with pytest.raises(GenerationConflict):
        check_update(session, GENERATION, renamed.get_update(before_rename))
    with pytest.raises(SeedConflict):
        check_update(session, GENERATION, claim.get_update(before))
    with pytest.raises(ValueError):
        check_update(session, GENERATION, b"\x01\x02\x03")
    monkeypatch.setattr(resident_module, "MAX_DOCUMENT_BYTES", 8)
    with pytest.raises(DocumentTooLarge):
        check_update(session, GENERATION, typed(base, suffix=" grows"))
    assert text_of(session.ydoc) == "base"


def test_session_state_waits_for_an_epoch_and_never_reports_watermark_above_head() -> None:
    session = YDocSession(
        key=(ContentType.NOTE, NOTE), ydoc=pycrdt.Doc(), organization_id=UUID(int=1)
    )
    assert session_state_message(session) is None
    session = resident(latest(baseline(), checkpoint_seq=4, revision=7))
    session.head_seq = 2
    assert parse_session_state_message(session_state_message(session) or b"") == SessionState(
        GENERATION, "epoch-1", 4, 4, 7
    )
