"""PostgreSQL serializes shared document generations and accepted update bytes."""

from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pycrdt
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions import role_can_edit
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.adapter import get_realtime_adapter
from uniffy.core.realtime.markdown import (
    DOC_GENERATION_KEY,
    DOC_META_FIELD,
    PROSEMIRROR_FRAGMENT_FIELD,
)
from uniffy.core.realtime.seeding import has_fragment_content
from uniffy.core.realtime.state import DocKey
from uniffy.infrastructure.database.session import open_session


class GenerationConflict(Exception):
    pass


class EditDenied(Exception):
    pass


async def lock_document(db: AsyncSession, key: DocKey, organization_id: UUID | None = None) -> None:
    if organization_id is not None:
        policy = await get_realtime_adapter(key[0]).policy_key(db, key[1], organization_id)
        if policy is not None:
            await db.execute(
                select(
                    func.pg_advisory_xact_lock_shared(
                        func.hashtextextended(f"realtime:{policy[0].value}:{policy[1]}", 0)
                    )
                )
            )
    await db.execute(
        select(
            func.pg_advisory_xact_lock(func.hashtextextended(f"realtime:{key[0].value}:{key[1]}", 0))
        )
    )


async def load_snapshot(db: AsyncSession, key: DocKey) -> RealtimeYjsSnapshot | None:
    return (
        await db.execute(
            select(RealtimeYjsSnapshot)
            .where(
                RealtimeYjsSnapshot.content_type == key[0],
                RealtimeYjsSnapshot.content_id == key[1],
            )
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def lock_documents(db: AsyncSession, keys: Iterable[DocKey]) -> None:
    for key in sorted(set(keys), key=lambda item: (item[0].value, str(item[1]))):
        await lock_document(db, key)


def decode_snapshot(snapshot: RealtimeYjsSnapshot) -> pycrdt.Doc:
    doc = pycrdt.Doc()
    doc.apply_update(snapshot.updates)
    return doc


async def stage_seed(db: AsyncSession, key: DocKey, organization_id: UUID) -> RealtimeYjsSnapshot:
    snapshot = await load_snapshot(db, key)
    if snapshot is None:
        doc = pycrdt.Doc()
        await get_realtime_adapter(key[0]).hydrate_ydoc(db, doc, key[1], organization_id)
        generation = str(uuid4())
        doc.get(DOC_META_FIELD, type=pycrdt.Map)[DOC_GENERATION_KEY] = generation
        snapshot = RealtimeYjsSnapshot(
            content_type=key[0],
            content_id=key[1],
            organization_id=organization_id,
            generation=generation,
            updates=doc.get_update(),
            state_vector=doc.get_state(),
        )
        db.add(snapshot)
    elif snapshot.generation is None:
        doc = decode_snapshot(snapshot)
        generation = doc.get(DOC_META_FIELD, type=pycrdt.Map).get(DOC_GENERATION_KEY)
        snapshot.generation = str(generation) if generation else ""
        snapshot.organization_id = organization_id
    return snapshot


async def stage_replacement(db: AsyncSession, key: DocKey, organization_id: UUID) -> None:
    """Call after staging domain content and before committing its transaction."""
    await db.flush()
    doc = pycrdt.Doc()
    await get_realtime_adapter(key[0]).hydrate_ydoc(db, doc, key[1], organization_id)
    generation = str(uuid4())
    doc.get(DOC_META_FIELD, type=pycrdt.Map)[DOC_GENERATION_KEY] = generation
    snapshot = await load_snapshot(db, key)
    if snapshot is None:
        snapshot = RealtimeYjsSnapshot(
            content_type=key[0], content_id=key[1], updates=b"", state_vector=b""
        )
    snapshot.organization_id = organization_id
    snapshot.generation = generation
    snapshot.seed_owner = None
    snapshot.seed_expires_at = None
    snapshot.updates = doc.get_update()
    snapshot.state_vector = doc.get_state()
    snapshot.revision += 1
    snapshot.rendered_revision = snapshot.revision
    snapshot.updated_at = datetime.now(UTC)
    db.add(snapshot)


async def claim_seed(
    key: DocKey, organization_id: UUID, candidates: list[str], replica: str
) -> str | None:
    async with open_session() as db:
        await lock_document(db, key)
        snapshot = await load_snapshot(db, key)
        if snapshot is None:
            return None
        fragment = decode_snapshot(snapshot).get(PROSEMIRROR_FRAGMENT_FIELD, type=pycrdt.XmlFragment)
        now = datetime.now(UTC)
        if has_fragment_content(fragment):
            snapshot.seed_owner = None
        elif (
            snapshot.seed_owner is None
            or snapshot.seed_expires_at is None
            or snapshot.seed_expires_at <= now
            or (
                snapshot.seed_owner.startswith(replica + ":")
                and snapshot.seed_owner not in candidates
            )
        ):
            # Another peer cannot keep a suspended owner alive by polling.
            successors = [candidate for candidate in candidates if candidate != snapshot.seed_owner]
            snapshot.seed_owner = next(iter(successors or candidates), None)
            snapshot.seed_expires_at = now + timedelta(seconds=45)
        await db.commit()
        return snapshot.seed_owner


async def accept_update(
    key: DocKey, organization_id: UUID, actor_id: UUID, generation: str, update: bytes
) -> RealtimeYjsSnapshot:
    async with open_session() as db:
        await lock_document(db, key, organization_id)
        role = await get_realtime_adapter(key[0]).authorize(db, actor_id, organization_id, key[1])
        if not role_can_edit(role):
            raise EditDenied
        snapshot = await stage_seed(db, key, organization_id)
        if snapshot.generation != generation:
            raise GenerationConflict
        # Merging encoded bytes retains updates whose causal predecessors arrive later.
        merged = pycrdt.merge_updates(snapshot.updates, update)
        doc = pycrdt.Doc()
        doc.apply_update(merged)
        if doc.get(DOC_META_FIELD, type=pycrdt.Map).get(DOC_GENERATION_KEY, "") != generation:
            raise GenerationConflict
        if merged != snapshot.updates:
            snapshot.updates = merged
            snapshot.state_vector = doc.get_state()
            snapshot.revision += 1
            snapshot.actor_id = actor_id
            snapshot.updated_at = datetime.now(UTC)
        await db.commit()
        return snapshot
