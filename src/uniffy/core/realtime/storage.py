"""PostgreSQL document locks, shared generation seeding and fragment seed leases."""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pycrdt
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.adapter import get_realtime_adapter
from uniffy.core.realtime.markdown import DOC_GENERATION_KEY, DOC_META_FIELD
from uniffy.core.realtime.state import DocKey

SEED_LEASE = timedelta(seconds=45)


class GenerationConflict(Exception):
    pass


class SeedConflict(Exception):
    pass


@dataclass(frozen=True)
class SeedLease:
    owner: str
    expires_at: datetime

    @property
    def token(self) -> str:
        return self.expires_at.isoformat()


class EditDenied(Exception):
    pass


class DocumentTooLarge(Exception):
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


def compact_update(raw: bytes) -> bytes:
    """Collect deleted content without losing unresolved causal structs."""
    doc = pycrdt.Doc()
    doc.apply_update(raw)
    pending = pycrdt.get_update(raw, doc.get_state())
    return pycrdt.merge_updates(doc.get_update(), pending)


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


def elect_seed_owner(
    snapshot: RealtimeYjsSnapshot, *, initialized: bool, candidates: list[str], replica: str
) -> SeedLease | None:
    """Keep or hand over the seed lease; an initialized fragment needs no seeder."""
    now = datetime.now(UTC)
    if initialized:
        snapshot.seed_owner = None
    elif (
        snapshot.seed_owner is None
        or snapshot.seed_expires_at is None
        or snapshot.seed_expires_at <= now
        or (snapshot.seed_owner.startswith(replica + ":") and snapshot.seed_owner not in candidates)
    ):
        # Another peer cannot keep a suspended owner alive by polling.
        successors = [candidate for candidate in candidates if candidate != snapshot.seed_owner]
        snapshot.seed_owner = next(iter(successors or candidates), None)
        snapshot.seed_expires_at = now + SEED_LEASE
    return (
        SeedLease(snapshot.seed_owner, snapshot.seed_expires_at)
        if snapshot.seed_owner and snapshot.seed_expires_at
        else None
    )
