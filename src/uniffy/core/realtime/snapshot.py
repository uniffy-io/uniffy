"""Project committed realtime checkpoints into domain columns and their durable effects."""

from enum import StrEnum
from uuid import UUID

from uniffy.core.realtime.adapter import DeferredProjection, get_realtime_adapter
from uniffy.core.realtime.storage import decode_snapshot, load_snapshot, lock_document
from uniffy.core.types import ContentType
from uniffy.infrastructure.database.session import open_session


class SnapshotOutcome(StrEnum):
    RENDERED = "rendered"
    SNAPSHOT_ONLY = "snapshot_only"
    TARGET_MISSING = "target_missing"
    SUPERSEDED = "superseded"


async def persist_snapshot(
    content_type: ContentType, content_id: UUID, organization_id: UUID
) -> SnapshotOutcome:
    """Render the committed checkpoint under the document lock; projection jobs carry no state."""
    async with open_session() as db:
        key = (content_type, content_id)
        await lock_document(db, key, organization_id)
        snapshot = await load_snapshot(db, key)
        if snapshot is None or snapshot.organization_id != organization_id:
            return SnapshotOutcome.SUPERSEDED
        if snapshot.rendered_revision >= snapshot.revision:
            if snapshot.effects_pending:
                await get_realtime_adapter(content_type).after_projection(
                    db, content_id, organization_id
                )
                snapshot.effects_pending = False
                await db.commit()
            return SnapshotOutcome.RENDERED
        adapter = get_realtime_adapter(content_type)
        after_commit = await adapter.stage_render(
            db,
            decode_snapshot(snapshot),
            content_id,
            organization_id,
            actor_id=snapshot.actor_id,
        )
        if after_commit is DeferredProjection.SOFT_DELETED:
            return SnapshotOutcome.SNAPSHOT_ONLY
        if after_commit is None:
            await db.delete(snapshot)
            await db.commit()
            return SnapshotOutcome.TARGET_MISSING
        snapshot.effects_pending = True
        snapshot.rendered_revision = snapshot.revision
        await db.commit()
        # Serialize effect delivery with newer projections so search cannot regress.
        await lock_document(db, key, organization_id)
        current = await load_snapshot(db, key)
        if current is not None and current.effects_pending:
            await after_commit()
            current.effects_pending = False
            await db.commit()
        return SnapshotOutcome.RENDERED
