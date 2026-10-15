"""PostgreSQL serializes shared document generations and accepted update bytes."""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pycrdt
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions import role_can_edit
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.adapter import get_realtime_adapter
from uniffy.core.realtime.limits import (
    MAX_DOCUMENT_BYTES,
    MAX_SNAPSHOT_BYTES,
    validate_document_size,
)
from uniffy.core.realtime.markdown import (
    DOC_GENERATION_KEY,
    DOC_META_FIELD,
    MARKDOWN_MIRROR_FIELD,
    PROSEMIRROR_FRAGMENT_FIELD,
    markdown_text,
    replace_external_markdown,
)
from uniffy.core.realtime.merge import merge_plain_text
from uniffy.core.realtime.seeding import has_fragment_content
from uniffy.core.realtime.state import DocKey
from uniffy.infrastructure.database.session import open_session


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


async def stage_text_merge(
    db: AsyncSession,
    key: DocKey,
    organization_id: UUID,
    actor_id: UUID,
    *,
    base: str,
    incoming: str,
) -> str | None:
    """Graft a plain markdown write into the live generation; the caller stores the result.

    ``base`` is the column text the writer saw. Returns ``None`` when no snapshot row exists:
    nothing is live, the column write stands and a later cold open hydrates from it.
    Call under ``lock_document`` before committing the domain transaction.
    """
    validate_document_size(incoming)
    snapshot = await load_snapshot(db, key)
    if snapshot is None:
        return None
    doc = decode_snapshot(snapshot)
    merged = merge_plain_text(base=base, live=str(markdown_text(doc)), incoming=incoming)
    validate_document_size(merged)
    before = doc.get_state()
    if replace_external_markdown(doc, merged):
        snapshot.updates = pycrdt.merge_updates(snapshot.updates, doc.get_update(before))
        snapshot.state_vector = doc.get_state()
        snapshot.revision += 1
    snapshot.organization_id = organization_id
    # The column receives the merged text in this transaction, so the row is projected.
    snapshot.rendered_revision = snapshot.revision
    snapshot.actor_id = actor_id
    snapshot.updated_at = datetime.now(UTC)
    db.add(snapshot)
    return merged


async def stage_replacement(db: AsyncSession, key: DocKey, organization_id: UUID) -> None:
    """Mint a fresh generation from the staged domain columns; stale clients cannot replay into it.

    Canvas content and callers that need a new lineage use this. Plain markdown writes use
    :func:`stage_text_merge`, which keeps the live generation. Call after staging domain content
    and before committing its transaction.
    """
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
) -> SeedLease | None:
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
        return (
            SeedLease(snapshot.seed_owner, snapshot.seed_expires_at)
            if snapshot.seed_owner and snapshot.seed_expires_at
            else None
        )


async def accept_update(
    key: DocKey,
    organization_id: UUID,
    actor_id: UUID,
    generation: str,
    update: bytes,
    *,
    seed_owner: str | None = None,
    seed_token: str | None = None,
    seed_base: str | None = None,
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
        if len(merged) > MAX_SNAPSHOT_BYTES:
            raise DocumentTooLarge
        doc = pycrdt.Doc()
        doc.apply_update(merged)
        if len(str(markdown_text(doc)).encode()) > MAX_DOCUMENT_BYTES:
            raise DocumentTooLarge
        if doc.get(DOC_META_FIELD, type=pycrdt.Map).get(DOC_GENERATION_KEY, "") != generation:
            raise GenerationConflict
        if merged != snapshot.updates:
            before = decode_snapshot(snapshot)
            previous_claims = before.get(MARKDOWN_MIRROR_FIELD, type=pycrdt.Map)
            claims = doc.get(MARKDOWN_MIRROR_FIELD, type=pycrdt.Map)
            introduces_seed = any(
                key.startswith("seeded_by:") and key not in previous_claims for key in claims
            )
            if seed_owner is not None:
                if (
                    snapshot.seed_owner != seed_owner
                    or snapshot.seed_expires_at is None
                    or snapshot.seed_expires_at <= datetime.now(UTC)
                    or snapshot.seed_expires_at.isoformat() != seed_token
                    or str(markdown_text(before)) != seed_base
                    or str(markdown_text(doc)) != seed_base
                    or not introduces_seed
                    or has_fragment_content(
                        before.get(PROSEMIRROR_FRAGMENT_FIELD, type=pycrdt.XmlFragment)
                    )
                ):
                    raise SeedConflict
            elif introduces_seed:
                raise SeedConflict
            snapshot.updates = merged
            snapshot.state_vector = doc.get_state()
            snapshot.revision += 1
            snapshot.actor_id = actor_id
            snapshot.updated_at = datetime.now(UTC)
        await db.commit()
        return snapshot
