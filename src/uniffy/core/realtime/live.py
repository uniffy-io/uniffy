"""Live realtime document state and the barriers that commit it inside a caller's transaction.

Live state is the PostgreSQL checkpoint plus the verified buffered tail. Barriers stage row
writes into the caller's transaction, never commit, and return the cleanup that runs after it.
"""

import contextlib
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

import pycrdt
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions import role_can_edit
from uniffy.core.errors import UnavailableError
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.adapter import get_realtime_adapter
from uniffy.core.realtime.buffer import (
    AdmissionUnknown,
    BufferUnavailable,
    RecoveryReason,
    RecoveryRequired,
    UpdateBuffer,
)
from uniffy.core.realtime.buffer_keys import (
    BufferedUpdate,
    BufferHead,
    BufferScope,
    merge_tail,
)
from uniffy.core.realtime.checkpoint import (
    Enqueue,
    clean_checkpoint,
    enqueue_core,
    enqueue_projection,
    publish_progress,
    stage_checkpoint,
)
from uniffy.core.realtime.epoch import row_scope, start_epoch, surviving_prefix
from uniffy.core.realtime.limits import (
    MAX_DOCUMENT_BYTES,
    MAX_SNAPSHOT_BYTES,
    validate_document_size,
)
from uniffy.core.realtime.markdown import (
    DOC_GENERATION_KEY,
    DOC_META_FIELD,
    PROSEMIRROR_FRAGMENT_FIELD,
    markdown_text,
    replace_external_markdown,
)
from uniffy.core.realtime.merge import merge_plain_text
from uniffy.core.realtime.metrics import (
    REALTIME_BUFFER_EPOCH_RESETS_TOTAL,
    REALTIME_CHECKPOINT_TRIM_DEBT_TOTAL,
)
from uniffy.core.realtime.preflight import PreflightVerdict, ensure_buffer_ready, preflight_result
from uniffy.core.realtime.resident import merge_change
from uniffy.core.realtime.seeding import has_fragment_content, seed_allowed
from uniffy.core.realtime.state import DocKey
from uniffy.core.realtime.storage import (
    DocumentTooLarge,
    EditDenied,
    GenerationConflict,
    SeedConflict,
    SeedLease,
    elect_seed_owner,
    load_snapshot,
    lock_document,
    stage_seed,
)
from uniffy.infrastructure.database.session import open_session
from uniffy.infrastructure.valkey.binary import server_identity

logger = logger.bind(component="core.realtime.live")

_READ_ATTEMPTS = 3

type AfterCommit = Callable[[], Awaitable[None]]


class LiveStateUnavailable(UnavailableError):
    """Retryable: buffered edits cannot be verified, so content writes wait rather than lose them."""


@dataclass(frozen=True, slots=True)
class _EpochReset:
    previous: BufferScope
    retire_through: int
    reason: RecoveryReason


@dataclass(frozen=True, slots=True)
class LiveDocument:
    """A snapshot row with its verified buffered tail, read under the caller's document lock."""

    row: RealtimeYjsSnapshot
    # The checkpoint merged with ``tail``.
    updates: bytes
    tail: tuple[BufferedUpdate, ...]
    # ``None`` without a usable epoch: the row records none, or the next staged write replaces it.
    head: BufferHead | None
    reset: _EpochReset | None = None

    @property
    def pending(self) -> bool:
        return bool(self.tail)

    @property
    def unprojected(self) -> bool:
        return self.row.revision > self.row.rendered_revision or self.pending

    def decode(self) -> pycrdt.Doc:
        doc = pycrdt.Doc()
        doc.apply_update(self.updates)
        return doc

    def text(self) -> str:
        return str(markdown_text(self.decode()))


@dataclass(frozen=True, slots=True)
class TextMerge:
    text: str
    after_commit: AfterCommit


@dataclass(frozen=True, slots=True)
class _Staged:
    key: DocKey
    organization_id: UUID
    # ``None`` for a document without an epoch, which has nothing to trim or announce.
    scope: BufferScope | None
    covered: int
    revision: int
    records: int
    project: bool


@contextlib.asynccontextmanager
async def _verified() -> AsyncIterator[None]:
    try:
        yield
    except (BufferUnavailable, AdmissionUnknown, RecoveryRequired) as exc:
        raise LiveStateUnavailable("Pending realtime edits cannot be verified; retry") from exc


def _merged(checkpoint: bytes, tail: tuple[BufferedUpdate, ...]) -> bytes:
    try:
        return merge_tail(checkpoint, tail)
    except ValueError as exc:
        raise LiveStateUnavailable("A pending realtime edit cannot be read; retry") from exc


async def _surviving(
    buffer: UpdateBuffer, row: RealtimeYjsSnapshot, reason: RecoveryReason
) -> LiveDocument:
    recovered, through = await surviving_prefix(buffer, row)
    reset = _EpochReset(row_scope(row), through, reason)
    return LiveDocument(row, _merged(row.updates, recovered), recovered, None, reset)


async def _read(
    buffer: UpdateBuffer, db: AsyncSession, key: DocKey, row: RealtimeYjsSnapshot
) -> LiveDocument | None:
    try:
        state = await buffer.load_latest(db, key)
    except RecoveryRequired as exc:
        if exc.reason is RecoveryReason.MALFORMED:
            raise LiveStateUnavailable("A pending realtime edit cannot be read; retry") from exc
        if exc.reason is RecoveryReason.IDENTITY_CHANGED:
            identity = await buffer.adopt_identity()
            if identity.run_id == row.valkey_run_id:
                # Only this process's record of the serving instance was stale.
                raise
        return await _surviving(buffer, row, exc.reason)
    if state is None:
        return None
    return LiveDocument(row, _merged(state.checkpoint, state.tail), state.tail, state.head)


async def load_live_document(
    buffer: UpdateBuffer, db: AsyncSession, key: DocKey
) -> LiveDocument | None:
    """Checkpoint plus verified tail under the caller's document lock; ``None`` without a row.

    Reads only. A lost or replaced epoch yields its provable surviving prefix as the tail, and
    the next staged write moves the document to a fresh epoch.
    """
    row = await load_snapshot(db, key)
    if row is None:
        return None
    if row.buffer_epoch is None:
        # Appends need the epoch recorded in this row, so nothing can be pending.
        return LiveDocument(row, row.updates, (), None)
    await ensure_buffer_ready()
    result = preflight_result()
    if result is not None and result.verdict is PreflightVerdict.DISABLED:
        raise LiveStateUnavailable("Pending realtime edits cannot be verified; retry")
    async with _verified():
        for _ in range(_READ_ATTEMPTS):
            # A changed serving instance shows up as RecoveryRequired; read again under it.
            with contextlib.suppress(RecoveryRequired):
                return await _read(buffer, db, key, row)
    raise LiveStateUnavailable("Pending realtime edits cannot be verified; retry")


async def has_unprojected_content(buffer: UpdateBuffer, db: AsyncSession, key: DocKey) -> bool:
    """Whether accepted edits have not reached the domain columns yet, buffered ones included."""
    live = await load_live_document(buffer, db, key)
    return live is not None and live.unprojected


async def may_have_unprojected_edits(buffer: UpdateBuffer, db: AsyncSession, key: DocKey) -> bool:
    """Whether accepted edits may be missing from the domain columns; unverifiable state counts."""
    try:
        return await has_unprojected_content(buffer, db, key)
    except LiveStateUnavailable:
        return True


async def _settled() -> None:
    return None


async def _settle(buffer: UpdateBuffer, staged: _Staged, enqueue: Enqueue) -> None:
    if staged.scope is not None:
        if staged.records:
            try:
                await clean_checkpoint(buffer, staged.scope)
            except BufferUnavailable, RecoveryRequired:
                REALTIME_CHECKPOINT_TRIM_DEBT_TOTAL.labels(event="left").inc(staged.records)
                logger.opt(exception=True).warning(
                    "Committed buffer prefix left for maintenance cleanup"
                )
        await publish_progress(staged.scope, staged.covered, staged.revision)
    if staged.project:
        await enqueue_projection(
            buffer, staged.key, staged.organization_id, staged.revision, enqueue
        )


def _after_commit(
    buffer: UpdateBuffer, staged: _Staged, reset: _EpochReset | None, enqueue: Enqueue
) -> AfterCommit:
    async def settle() -> None:
        # The commit already stands; anything left here is repaired by maintenance and recovery.
        if reset is not None:
            buffer.forget(staged.key)
            REALTIME_BUFFER_EPOCH_RESETS_TOTAL.labels(reason=reset.reason.value).inc()
            try:
                await buffer.retire(reset.previous, reset.retire_through)
            except Exception:
                logger.opt(exception=True).warning("Retired buffer epoch keys left for maintenance")
        try:
            await _settle(buffer, staged, enqueue)
        except Exception:
            logger.opt(exception=True).warning("Realtime cleanup after commit left for maintenance")

    return settle


async def stage_live_checkpoint(
    buffer: UpdateBuffer,
    db: AsyncSession,
    live: LiveDocument,
    organization_id: UUID,
    updates: bytes,
    *,
    actor_id: UUID | None,
    project: bool,
    enqueue: Enqueue = enqueue_core,
) -> AfterCommit:
    """Stage ``updates``, which contain the whole live tail, as the checkpoint covering it.

    A document whose epoch cannot take appends moves to a fresh epoch in the same transaction;
    the old epoch retires after the commit. ``project`` schedules projection after the commit.
    """
    row = live.row
    scope, covered, records = None, row.checkpoint_seq, len(live.tail)
    if live.head is not None:
        scope, covered = live.head.scope, live.head.head_seq
    identity = None
    if live.reset is not None:
        identity = server_identity()
        if identity is None:
            raise LiveStateUnavailable("Pending realtime edits cannot be verified; retry")
        covered, records = 0, 0
    try:
        stage_checkpoint(row, updates, covered=covered, actor_id=actor_id)
    except ValueError as exc:
        raise LiveStateUnavailable("A pending realtime edit cannot be read; retry") from exc
    if identity is not None:
        async with _verified():
            scope = await start_epoch(buffer, row, organization_id, identity)
    row.organization_id = organization_id
    db.add(row)
    staged = _Staged(
        (row.content_type, row.content_id),
        organization_id,
        scope,
        covered,
        row.revision,
        records,
        project,
    )
    return _after_commit(buffer, staged, live.reset, enqueue)


async def stage_text_merge(
    buffer: UpdateBuffer,
    db: AsyncSession,
    key: DocKey,
    organization_id: UUID,
    actor_id: UUID,
    *,
    base: str | None,
    stored: str,
    incoming: str,
) -> TextMerge:
    """Three-way merge a plain write into live state under the caller's document lock.

    The row commits the merged bytes as the checkpoint covering the buffered tail while the
    domain column takes ``text`` in the same transaction, so the row counts as projected. Without
    a snapshot row the merge runs against ``stored``.
    """
    validate_document_size(incoming)
    live = await load_live_document(buffer, db, key)
    if live is None:
        merged = merge_plain_text(base=base, live=stored, incoming=incoming)
        validate_document_size(merged)
        return TextMerge(merged, _settled)
    doc = live.decode()
    merged = merge_plain_text(base=base, live=str(markdown_text(doc)), incoming=incoming)
    validate_document_size(merged)
    before = doc.get_state()
    after_commit = _settled
    if replace_external_markdown(doc, merged) or live.pending:
        after_commit = await stage_live_checkpoint(
            buffer,
            db,
            live,
            organization_id,
            pycrdt.merge_updates(live.updates, doc.get_update(before)),
            actor_id=actor_id,
            project=False,
        )
    row = live.row
    row.organization_id = organization_id
    row.rendered_revision = row.revision
    row.actor_id = actor_id
    row.updated_at = datetime.now(UTC)
    db.add(row)
    return TextMerge(merged, after_commit)


async def claim_seed(
    buffer: UpdateBuffer,
    key: DocKey,
    organization_id: UUID,
    candidates: list[str],
    replica: str,
) -> SeedLease | None:
    """Elect one fragment seeder; a fragment initialized in live state needs none."""
    async with open_session() as db:
        await lock_document(db, key, organization_id)
        live = await load_live_document(buffer, db, key)
        if live is None:
            return None
        fragment = live.decode().get(PROSEMIRROR_FRAGMENT_FIELD, type=pycrdt.XmlFragment)
        lease = elect_seed_owner(
            live.row,
            initialized=has_fragment_content(fragment),
            candidates=candidates,
            replica=replica,
        )
        await db.commit()
        return lease


async def accept_seed(
    buffer: UpdateBuffer,
    key: DocKey,
    organization_id: UUID,
    actor_id: UUID,
    generation: str,
    update: bytes,
    *,
    seed_owner: str,
    seed_token: str,
    seed_base: str,
    enqueue: Enqueue = enqueue_core,
) -> RealtimeYjsSnapshot:
    """Commit a fragment seed together with the buffered tail it was validated against.

    On return PostgreSQL holds the seed and every edit accepted before it, so a committed
    acknowledgment may follow. Replaying a committed seed changes nothing.
    """
    async with open_session() as db:
        await lock_document(db, key, organization_id)
        role = await get_realtime_adapter(key[0]).authorize(db, actor_id, organization_id, key[1])
        if not role_can_edit(role):
            raise EditDenied
        await stage_seed(db, key, organization_id)
        live = await load_live_document(buffer, db, key)
        if live is None or live.row.generation != generation:
            raise GenerationConflict
        before, after = live.decode(), live.decode()
        after.apply_update(update)
        if after.get(DOC_META_FIELD, type=pycrdt.Map).get(DOC_GENERATION_KEY, "") != generation:
            raise GenerationConflict
        if merge_change(before.get_update(), update) is None:
            await db.commit()
            return live.row
        merged = pycrdt.merge_updates(live.updates, update)
        if (
            len(merged) > MAX_SNAPSHOT_BYTES
            or len(str(markdown_text(after)).encode()) > MAX_DOCUMENT_BYTES
        ):
            raise DocumentTooLarge
        if not seed_allowed(
            live.row, before, after, owner=seed_owner, token=seed_token, base=seed_base
        ):
            raise SeedConflict
        after_commit = await stage_live_checkpoint(
            buffer,
            db,
            live,
            organization_id,
            merged,
            actor_id=actor_id,
            project=True,
            enqueue=enqueue,
        )
        await db.commit()
    await after_commit()
    return live.row
