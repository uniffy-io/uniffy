"""A resident document follows its PostgreSQL checkpoint and verified buffered tail.

Admission validates incoming updates against it, never against a fresh decode of PostgreSQL.
"""

from enum import Enum, auto

import pycrdt

from uniffy.core.realtime.buffer_keys import (
    BufferedUpdate,
    BufferHead,
    HeldState,
    LatestState,
    LatestTail,
    merge_tail,
)
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

    ``current`` is a document encoding or a merge result, which merging alone leaves unchanged.
    Comparing raw merges also sees structs still waiting on predecessors, which a decoded
    document hides. A false change only sends the update through full validation.
    """
    merged = pycrdt.merge_updates(current, update)
    return None if merged == current else merged


def _mutate(session: YDocSession, update: bytes) -> list[bytes]:
    """Apply ``update`` to the resident document and its shadow; return what the document changed."""
    changes = _apply(session.ydoc, update)
    if session.shadow is not None:
        session.shadow.apply_update(update)
        session.encoded_bound += len(update)
    return changes


def _replace(session: YDocSession, encoded: bytes) -> None:
    session.ydoc = _decode(encoded)
    drop_shadow(session)


def drop_shadow(session: YDocSession) -> None:
    """Forget the validation copy; the next check rebuilds it from the resident document."""
    session.shadow = None
    session.shadow_ahead = False


def _settle_check(session: YDocSession) -> None:
    # A checked update the resident document never took must not stay in the shadow.
    if session.shadow_ahead:
        drop_shadow(session)


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
    _settle_check(session)
    head = state.head
    if head.scope.generation != session.generation:
        merged = state.merged()
        _replace(session, merged)
        _adopt(session, state)
        frames = [create_generation_message(session.generation)]
        return [*frames, *_state_frames(session), create_update_message(merged)]
    if head.scope.epoch != session.epoch:
        merged = state.merged()
        changes = _apply(session.ydoc, pycrdt.get_update(merged, session.ydoc.get_state()))
        _replace(session, merged)
        _adopt(session, state)
        frames = [*_state_frames(session), *map(create_update_message, changes)]
        return [*frames, create_sync_message(session.ydoc)]
    if head.checkpoint_revision != session.checkpoint_revision:
        changes = _mutate(session, pycrdt.get_update(state.merged(), session.ydoc.get_state()))
        return _advance(session, head, changes)
    return follow_tail(session, LatestTail(head, state.tail))


def held_state(session: YDocSession) -> HeldState | None:
    """What the resident document holds; ``None`` while it follows no epoch."""
    if session.epoch is None:
        return None
    return HeldState(
        session.generation,
        session.epoch,
        session.checkpoint_revision,
        session.checkpoint_seq,
        session.head_seq,
    )


def follow_tail(session: YDocSession, latest: LatestTail) -> list[bytes]:
    """Apply the records the resident document lacks within its generation, epoch and revision."""
    _settle_check(session)
    records: list[BufferedUpdate] = [
        record for record in latest.tail if record.seq > session.head_seq
    ]
    changes = _mutate(session, merge_tail(_NO_CHANGE, records)) if records else []
    return _advance(session, latest.head, changes)


def _advance(session: YDocSession, head: BufferHead, changes: list[bytes]) -> list[bytes]:
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
    # Admission may hold a checked update in the shadow meanwhile; both orders converge.
    _mutate(session, update)
    session.head_seq = sequence
    return Continuity.APPLIED


def _built_shadow(session: YDocSession) -> pycrdt.Doc:
    if session.shadow is None:
        encoded = session.ydoc.get_update()
        session.shadow = _decode(encoded)
        session.encoded_bound = len(encoded)
    return session.shadow


def _adds_structs(shadow: pycrdt.Doc, update: bytes) -> bool:
    known = decode_state_vector(shadow.get_state())
    carried = decode_state_vector(pycrdt.get_state(update))
    return any(clock > known.get(client, 0) for client, clock in carried.items())


def check_update(session: YDocSession, generation: str, update: bytes) -> bool:
    """Refuse an update the resident document cannot take, else say whether it adds anything.

    The update goes into the shadow only; :func:`accept_update` applies it to the resident
    document, and any other outcome drops the shadow. Raises ``ValueError`` for undecodable bytes.
    A seed claim only enters through a fragment seed proposal, so an ordinary update that adds one
    is a seed conflict.
    """
    _settle_check(session)
    if generation != session.generation:
        raise GenerationConflict
    shadow = _built_shadow(session)
    session.shadow_ahead = True
    try:
        changed = bool(_apply(shadow, update))
        # Structs waiting on predecessors and deletions of items not yet here change nothing
        # visible; only a raw merge tells them apart from an update the document already holds.
        if not changed and not _adds_structs(shadow, update):
            changed = merge_change(session.ydoc.get_update(), update) is not None
        if not changed:
            drop_shadow(session)
            return False
        if session.encoded_bound + len(update) > MAX_SNAPSHOT_BYTES:
            encoded = session.ydoc.get_update()
            session.encoded_bound = len(encoded)
            if len(pycrdt.merge_updates(encoded, update)) > MAX_SNAPSHOT_BYTES:
                raise DocumentTooLarge
        # Text length counts UTF-8 bytes, so it equals the encoded length of the Markdown.
        if len(markdown_text(shadow)) > MAX_DOCUMENT_BYTES:
            raise DocumentTooLarge
        if _meta_generation(shadow) != generation:
            raise GenerationConflict
        if adds_seed_claim(session.ydoc, shadow):
            raise SeedConflict
    except BaseException:
        drop_shadow(session)
        raise
    return True


def accept_update(session: YDocSession, update: bytes, seq: int) -> None:
    """Apply an update the buffer accepted at ``seq``; the shadow took it when it was checked."""
    session.ydoc.apply_update(update)
    if session.shadow_ahead and session.shadow is not None:
        session.encoded_bound += len(update)
        session.shadow_ahead = False
    else:
        drop_shadow(session)
    session.head_seq = max(session.head_seq, seq)


def release_update(session: YDocSession) -> None:
    """The checked update was not accepted; the shadow must not keep it."""
    _settle_check(session)


def holds_unknown_updates(session: YDocSession, state_vector: bytes) -> bool:
    """Whether a client at ``state_vector`` holds structs the resident document lacks.

    Within one epoch every accepted update is resident, so such a client has unsent edits or
    holds updates a buffer reset lost. Raises ``ValueError`` for an undecodable state vector.
    """
    known = decode_state_vector(session.ydoc.get_state())
    held = decode_state_vector(state_vector)
    return any(clock > known.get(client, 0) for client, clock in held.items())
