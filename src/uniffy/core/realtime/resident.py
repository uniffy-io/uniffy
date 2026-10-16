"""A resident document follows its PostgreSQL checkpoint and verified buffered tail.

Admission validates incoming updates against it, never against a fresh decode of PostgreSQL.
"""

from enum import Enum, auto

import pycrdt

from uniffy.core.realtime.buffer_keys import LatestState, merge_tail
from uniffy.core.realtime.limits import MAX_DOCUMENT_BYTES, MAX_SNAPSHOT_BYTES
from uniffy.core.realtime.markdown import DOC_GENERATION_KEY, DOC_META_FIELD, markdown_text
from uniffy.core.realtime.seeding import adds_seed_claim
from uniffy.core.realtime.state import YDocSession
from uniffy.core.realtime.storage import DocumentTooLarge, GenerationConflict, SeedConflict
from uniffy.core.realtime.wire import (
    create_generation_message,
    create_session_state_message,
    create_sync_message,
    create_update_message,
    decode_state_vector,
)

_NO_CHANGE = b"\x00\x00"


class Continuity(Enum):
    APPLIED = auto()
    KNOWN = auto()
    # The record does not continue the resident head; reload checkpoint plus tail.
    GAP = auto()


def _decode(update: bytes) -> pycrdt.Doc:
    doc = pycrdt.Doc()
    doc.apply_update(update)
    return doc


def merge_change(current: bytes, update: bytes) -> bytes | None:
    """``current`` merged with ``update``, or ``None`` when the update adds no struct or deletion.

    Comparing raw merges also sees structs still waiting on predecessors, which a decoded
    document hides. A false change only sends the update through full validation.
    """
    merged = pycrdt.merge_updates(current, update)
    return None if merged == pycrdt.merge_updates(current) else merged


def _apply(doc: pycrdt.Doc, update: bytes) -> list[bytes]:
    """Apply ``update`` and return only what it changed.

    A Yjs diff always repeats the whole delete set, so comparing bytes would resend known
    deletions; observing the document sees just the structs and deletions that landed.
    """
    changes: list[bytes] = []
    subscription = doc.observe(lambda event: changes.append(event.update))
    try:
        doc.apply_update(update)
    finally:
        doc.unobserve(subscription)
    return changes


def _meta_generation(doc: pycrdt.Doc) -> str:
    return str(doc.get(DOC_META_FIELD, type=pycrdt.Map).get(DOC_GENERATION_KEY, ""))


def session_state_message(session: YDocSession) -> bytes | None:
    """Type 13 for the epoch the resident document follows; ``None`` until it is known."""
    if session.epoch is None:
        return None
    return create_session_state_message(
        generation=session.generation,
        epoch=session.epoch,
        head_sequence=max(session.head_seq, session.checkpoint_seq),
        checkpoint_sequence=session.checkpoint_seq,
        checkpoint_revision=session.checkpoint_revision,
    )


def _adopt(session: YDocSession, state: LatestState) -> None:
    head = state.head
    session.generation = head.scope.generation
    session.epoch = head.scope.epoch
    session.head_seq = head.head_seq
    session.checkpoint_seq = head.checkpoint_seq
    session.checkpoint_revision = head.checkpoint_revision


def follow(session: YDocSession, state: LatestState) -> list[bytes]:
    """Align the resident document with ``state``; the frames go to every attached client.

    A new generation replaces the document. A new epoch rebuilds it from authority, because
    edits the old epoch lost must not stay resident, and asks clients for what they still hold.
    Within one epoch only what the resident document lacks is applied.
    """
    head = state.head
    if head.scope.generation != session.generation:
        merged = state.merged()
        session.ydoc = _decode(merged)
        _adopt(session, state)
        frames = [create_generation_message(session.generation)]
        return [*frames, *_state_frames(session), create_update_message(merged)]
    if head.scope.epoch != session.epoch:
        merged = state.merged()
        changes = _apply(session.ydoc, pycrdt.get_update(merged, session.ydoc.get_state()))
        session.ydoc = _decode(merged)
        _adopt(session, state)
        frames = [*_state_frames(session), *map(create_update_message, changes)]
        return [*frames, create_sync_message(session.ydoc)]
    if head.checkpoint_revision != session.checkpoint_revision:
        changes = _apply(session.ydoc, pycrdt.get_update(state.merged(), session.ydoc.get_state()))
    else:
        records = [record for record in state.tail if record.seq > session.head_seq]
        changes = _apply(session.ydoc, merge_tail(_NO_CHANGE, records)) if records else []
    session.head_seq = max(session.head_seq, head.head_seq)
    session.checkpoint_seq = max(session.checkpoint_seq, head.checkpoint_seq)
    session.checkpoint_revision = max(session.checkpoint_revision, head.checkpoint_revision)
    return [create_update_message(change) for change in changes]


def _state_frames(session: YDocSession) -> list[bytes]:
    frame = session_state_message(session)
    return [] if frame is None else [frame]


def handshake_messages(session: YDocSession) -> list[bytes]:
    """Generation, then session state, so a client reconciles receipts before any sync."""
    return [create_generation_message(session.generation), *_state_frames(session)]


def follow_record(
    session: YDocSession, generation: str, epoch: str, sequence: int, update: bytes
) -> Continuity:
    """Apply one accepted record when it continues the resident head of its epoch."""
    if (generation, epoch) != (session.generation, session.epoch):
        return Continuity.GAP
    if sequence <= session.head_seq:
        return Continuity.KNOWN
    if sequence != session.head_seq + 1:
        return Continuity.GAP
    session.ydoc.apply_update(update)
    session.head_seq = sequence
    return Continuity.APPLIED


def check_update(session: YDocSession, generation: str, update: bytes) -> bool:
    """Refuse an update the resident document cannot take, else say whether it adds anything.

    Nothing is applied. Raises ``ValueError`` for undecodable bytes. A seed claim only enters
    through a fragment seed proposal, so an ordinary update that adds one is a seed conflict.
    """
    if generation != session.generation:
        raise GenerationConflict
    resident = session.ydoc
    merged = merge_change(resident.get_update(), update)
    if merged is None:
        return False
    if len(merged) > MAX_SNAPSHOT_BYTES:
        raise DocumentTooLarge
    after = _decode(merged)
    if len(str(markdown_text(after)).encode()) > MAX_DOCUMENT_BYTES:
        raise DocumentTooLarge
    if _meta_generation(after) != generation:
        raise GenerationConflict
    if adds_seed_claim(resident, after):
        raise SeedConflict
    return True


def holds_unknown_updates(session: YDocSession, state_vector: bytes) -> bool:
    """Whether a client at ``state_vector`` holds structs the resident document lacks.

    Within one epoch every accepted update is resident, so such a client has unsent edits or
    holds updates a buffer reset lost. Raises ``ValueError`` for an undecodable state vector.
    """
    known = decode_state_vector(session.ydoc.get_state())
    held = decode_state_vector(state_vector)
    return any(clock > known.get(client, 0) for client, clock in held.items())
