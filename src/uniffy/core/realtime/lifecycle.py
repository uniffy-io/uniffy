"""Replacement, trash, restore and deletion barriers over live realtime state."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

import pycrdt
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.adapter import get_realtime_adapter
from uniffy.core.realtime.buffer import RecoveryRequired, UpdateBuffer
from uniffy.core.realtime.buffer_keys import BufferScope
from uniffy.core.realtime.checkpoint import (
    Enqueue,
    enqueue_core,
    enqueue_projection,
    publish_progress,
)
from uniffy.core.realtime.epoch import row_scope
from uniffy.core.realtime.live import AfterCommit, load_live_document, stage_live_checkpoint
from uniffy.core.realtime.markdown import DOC_GENERATION_KEY, DOC_META_FIELD
from uniffy.core.realtime.state import DocKey
from uniffy.core.realtime.storage import load_snapshot
from uniffy.core.realtime.wire import MAX_WIRE_INTEGER

logger = logger.bind(component="core.realtime.lifecycle")


async def _nothing() -> None:
    return None


def _scope_of(row: RealtimeYjsSnapshot) -> BufferScope | None:
    try:
        return row_scope(row)
    except RecoveryRequired:
        return None


def _retire_after_commit(
    buffer: UpdateBuffer, key: DocKey, scope: BufferScope | None
) -> AfterCommit:
    async def retire() -> None:
        buffer.forget(key)
        if scope is None:
            return
        try:
            await buffer.retire(scope, MAX_WIRE_INTEGER)
        except Exception:
            logger.opt(exception=True).warning("Obsolete buffer keys left for maintenance")

    return retire


async def stage_replacement(
    buffer: UpdateBuffer, db: AsyncSession, key: DocKey, organization_id: UUID
) -> AfterCommit:
    """Mint a fresh generation from the staged domain columns; old-generation drafts never replay.

    Reads nothing from the old lineage, so no buffer access precedes the commit. The generation
    starts without an epoch, and the old generation's buffer keys retire after the commit.
    """
    await db.flush()
    doc = pycrdt.Doc()
    await get_realtime_adapter(key[0]).hydrate_ydoc(db, doc, key[1], organization_id)
    generation = str(uuid4())
    doc.get(DOC_META_FIELD, type=pycrdt.Map)[DOC_GENERATION_KEY] = generation
    row = await load_snapshot(db, key)
    if row is None:
        row = RealtimeYjsSnapshot(
            content_type=key[0], content_id=key[1], updates=b"", state_vector=b""
        )
    previous = _scope_of(row)
    row.organization_id = organization_id
    row.generation = generation
    row.seed_owner = None
    row.seed_expires_at = None
    row.updates = doc.get_update()
    row.state_vector = doc.get_state()
    row.buffer_epoch = None
    row.valkey_run_id = None
    row.checkpoint_seq = 0
    row.revision += 1
    row.rendered_revision = row.revision
    row.updated_at = datetime.now(UTC)
    db.add(row)
    return _retire_after_commit(buffer, key, previous)


async def stage_trash(
    buffer: UpdateBuffer, db: AsyncSession, key: DocKey, organization_id: UUID
) -> AfterCommit:
    """Fold the buffered tail into the row before trash, leaving projection and effects alone.

    Trashed content keeps every accepted edit for restore; an unverifiable tail fails retryably.
    """
    live = await load_live_document(buffer, db, key)
    if live is None or not live.pending:
        return _nothing
    return await stage_live_checkpoint(
        buffer,
        db,
        live,
        organization_id,
        live.updates,
        actor_id=live.tail[-1].actor_id,
        project=False,
    )


async def stage_restore(
    buffer: UpdateBuffer,
    db: AsyncSession,
    key: DocKey,
    organization_id: UUID,
    *,
    enqueue: Enqueue = enqueue_core,
) -> AfterCommit:
    """Restored content renders through the projection job once the caller commits."""
    row = await load_snapshot(db, key)
    if row is None:
        return _nothing
    scope = _scope_of(row)
    covered, revision = row.checkpoint_seq, row.revision
    project = row.revision > row.rendered_revision

    async def restored() -> None:
        if scope is not None:
            await publish_progress(scope, covered, revision)
        if project:
            await enqueue_projection(buffer, key, organization_id, revision, enqueue)

    return restored


async def stage_hard_delete(buffer: UpdateBuffer, db: AsyncSession, key: DocKey) -> AfterCommit:
    """Delete the snapshot row in the caller's transaction; its buffer keys retire afterwards.

    Later appends find no control record and answer recovery required, and without a row no
    new epoch can be established for them.
    """
    row = await load_snapshot(db, key)
    if row is None:
        return _retire_after_commit(buffer, key, None)
    previous = _scope_of(row)
    await db.delete(row)
    return _retire_after_commit(buffer, key, previous)
