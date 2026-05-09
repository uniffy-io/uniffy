"""Stress + bench for the cached tag-visibility predicate.

Seeds a known dataset (notes across access modes + a tag-and-assignment
matrix), then benches ``list_tags(actor_id=...)`` and
``list_content(actor_id=...)`` cold vs warm to confirm the
visible-set cache lands the predicted speedup. Also runs
``EXPLAIN ANALYZE`` on the page query and prints the plan.

Usage:
    docker exec uniffy-dev-backend uv run python -m \\
        uniffy.scripts.stress.tags_visibility_stress [--notes 1200] \\
        [--tags 100] [--assignments 50] [--iterations 20]

The script is idempotent in a sense: running it again skips seeding
when the stress org already has the marker prefix in tag names. To
re-seed, pass ``--reseed``.
"""

import argparse
import asyncio
import os
import random
import statistics
import time
from dataclasses import dataclass
from uuid import UUID

from loguru import logger
from sqlalchemy import delete, select, text

LOGGER_COMPONENT = "stress.tags_visibility"

# All seed rows carry this prefix so we can find / wipe them cheaply.
SEED_TAG_PREFIX = "vsstress-"
SEED_NOTE_PREFIX = "Visibility stress: "


@dataclass
class StressConfig:
    """Configuration for the visibility-cache stress run."""

    note_count: int = 1200
    tag_count: int = 100
    assignments_per_tag: int = 50
    iterations: int = 20
    reseed: bool = False
    skip_seed: bool = False


async def _resolve_org_and_users(session) -> tuple[object, list[object]]:
    """Pick the dev org plus the canonical six dev users."""
    from uniffy.core.models import Organization, User

    org_slug = os.environ.get("DEFAULT_ORG_SLUG")
    if not org_slug:
        from uniffy.core.types import slugify

        org_name = os.environ.get("DEFAULT_ORG_NAME", "Default")
        org_slug = slugify(org_name)

    org = (
        await session.execute(
            select(Organization).where(Organization.slug == org_slug)
        )
    ).scalar_one_or_none()
    if org is None:
        raise RuntimeError(
            f"Organization with slug {org_slug!r} not found. Run dev seed first."
        )

    user_emails = [
        "admin@uniffy.io",
        "alice@uniffy.io",
        "bob@uniffy.io",
        "charlie@uniffy.io",
        "diana@uniffy.io",
        "eve@uniffy.io",
    ]
    users = list(
        (
            await session.execute(select(User).where(User.email.in_(user_emails)))
        ).scalars().all()
    )
    if len(users) < 2:
        raise RuntimeError("Not enough dev users found. Run dev seed first.")
    return org, users


async def _wipe_seed(session, organization_id: UUID) -> None:
    """Drop tags / notes carrying the seed marker prefix (PG + Meili)."""
    from uniffy.core.models.notes.note import Note
    from uniffy.core.models.tags.tag import Tag, TagAssignment
    from uniffy.core.search.indexer import SearchIndexer

    seed_tag_ids = list(
        (
            await session.execute(
                select(Tag.id).where(
                    Tag.organization_id == organization_id,
                    Tag.slug.like(f"{SEED_TAG_PREFIX}%"),
                )
            )
        ).scalars().all()
    )
    if seed_tag_ids:
        await session.execute(
            delete(TagAssignment).where(TagAssignment.tag_id.in_(seed_tag_ids))
        )
        await session.execute(delete(Tag).where(Tag.id.in_(seed_tag_ids)))

    note_ids = list(
        (
            await session.execute(
                select(Note.id).where(
                    Note.organization_id == organization_id,
                    Note.title.like(f"{SEED_NOTE_PREFIX}%"),
                )
            )
        ).scalars().all()
    )
    if note_ids:
        await session.execute(delete(Note).where(Note.id.in_(note_ids)))

    await session.commit()

    indexer = SearchIndexer()
    for tag_id in seed_tag_ids:
        await indexer.remove(
            f"urn:uniffy:content:TAG:{tag_id}", organization_id
        )
    for note_id in note_ids:
        await indexer.remove(
            f"urn:uniffy:content:NOTE:{note_id}", organization_id
        )


async def _seed_existing(session, organization_id: UUID) -> bool:
    """Return True when stress seed data is already present."""
    from uniffy.core.models.tags.tag import Tag

    existing = (
        await session.execute(
            select(Tag.id)
            .where(
                Tag.organization_id == organization_id,
                Tag.slug.like(f"{SEED_TAG_PREFIX}%"),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    return existing is not None


async def _seed_notes(
    session,
    organization_id: UUID,
    users: list,
    count: int,
) -> list:
    """Create ``count`` notes spread across owners and access modes.

    Distribution roughly mirrors a real org:
    - 40% OWNER_ONLY (only owner can see)
    - 40% OPEN_TO_ORG with VIEWER baseline (everyone in the org sees it)
    - 20% EXPLICIT_MEMBERS with no member rows (only owner sees it)

    Also indexes every note into Meilisearch so the explorer's
    ``TagContentList`` can resolve URNs into proper chip cards (the
    resolve path is pure-Meili by design).
    """
    from uniffy.core.models.notes.note import Note
    from uniffy.core.search.indexer import SearchIndexer
    from uniffy.core.types import AccessMode, ContentRole, generate_id

    notes: list[Note] = []
    rng = random.Random(42)
    for idx in range(count):
        owner = rng.choice(users)
        roll = rng.random()
        if roll < 0.40:
            access_mode = AccessMode.OWNER_ONLY
            baseline = None
        elif roll < 0.80:
            access_mode = AccessMode.OPEN_TO_ORG
            baseline = ContentRole.VIEWER
        else:
            access_mode = AccessMode.EXPLICIT_MEMBERS
            baseline = None
        notes.append(
            Note(
                id=generate_id(),
                organization_id=organization_id,
                owner_id=owner.id,
                access_mode=access_mode,
                baseline_role=baseline,
                title=f"{SEED_NOTE_PREFIX}{idx:05d}",
                content="",
                slug=f"{SEED_TAG_PREFIX}note-{idx:05d}",
            )
        )
    session.add_all(notes)
    await session.commit()

    indexer = SearchIndexer()
    docs = [
        {
            "urn": f"urn:uniffy:content:NOTE:{n.id}",
            "organization_id": organization_id,
            "title": n.title,
            "entity_type": "note",
            "url_path": f"/notes/{n.id}",
            "owner_id": n.owner_id,
            "access_mode": n.access_mode,
            "baseline_role": n.baseline_role,
            "keywords": n.title,
            "description": "",
            "tags": [],
            "metadata": {"slug": n.slug},
        }
        for n in notes
    ]
    batch = 500
    for start in range(0, len(docs), batch):
        await indexer.batch_index(docs[start : start + batch])
    return notes


async def _seed_tags_and_assignments(
    session,
    organization_id: UUID,
    creator_id: UUID,
    note_ids: list[UUID],
    tag_count: int,
    assignments_per_tag: int,
) -> list[UUID]:
    """Create ``tag_count`` tags and assign each to a random note slice."""
    from datetime import UTC, datetime

    from uniffy.core.models.tags.tag import Tag, TagAssignment
    from uniffy.core.types import generate_id

    rng = random.Random(7)
    tags = [
        Tag(
            id=generate_id(),
            organization_id=organization_id,
            name=f"{SEED_TAG_PREFIX}{idx:04d}",
            slug=f"{SEED_TAG_PREFIX}{idx:04d}",
            created_by=creator_id,
        )
        for idx in range(tag_count)
    ]
    session.add_all(tags)
    await session.commit()

    now = datetime.now(UTC)
    assignments: list[TagAssignment] = []
    for tag in tags:
        per_tag = min(assignments_per_tag, len(note_ids))
        sample = rng.sample(note_ids, per_tag)
        for note_id in sample:
            assignments.append(
                TagAssignment(
                    tag_id=tag.id,
                    content_urn=f"urn:uniffy:content:NOTE:{note_id}",
                    content_type="NOTE",
                    sources=["manual"],
                    assigned_by=creator_id,
                    assigned_at=now,
                )
            )
    # Bulk insert in batches.
    batch = 500
    for start in range(0, len(assignments), batch):
        session.add_all(assignments[start : start + batch])
        await session.flush()
    await session.commit()
    return [t.id for t in tags]


async def _bench_list_tags(
    org_id: UUID,
    actor_id: UUID,
    iterations: int,
    *,
    label: str,
    cold: bool,
) -> dict[str, float]:
    """Time ``list_tags`` ``iterations`` times. Optionally cold per call."""
    from uniffy.core.auth.permissions.visible_sets import (
        invalidate_visible_sets_for_user,
    )
    from uniffy.db.session import open_session
    from uniffy.domains.tags.operations import TagOperations

    samples: list[float] = []
    for _ in range(iterations):
        if cold:
            await invalidate_visible_sets_for_user(org_id, actor_id)
        async with open_session() as session:
            ops = TagOperations(session)
            start = time.perf_counter()
            tags, counts, token = await ops.list_tags(
                organization_id=org_id,
                actor_id=actor_id,
                page_size=100,
            )
            samples.append(time.perf_counter() - start)
    return _summarise(label, samples)


async def _bench_list_content(
    org_id: UUID,
    actor_id: UUID,
    tag_slug: str,
    iterations: int,
    *,
    label: str,
    cold: bool,
) -> dict[str, float]:
    """Time ``list_content`` for a known popular tag."""
    from uniffy.core.auth.permissions.visible_sets import (
        invalidate_visible_sets_for_user,
    )
    from uniffy.db.session import open_session
    from uniffy.domains.tags.operations import TagOperations

    samples: list[float] = []
    for _ in range(iterations):
        if cold:
            await invalidate_visible_sets_for_user(org_id, actor_id)
        async with open_session() as session:
            ops = TagOperations(session)
            start = time.perf_counter()
            assignments, token = await ops.list_content(
                organization_id=org_id,
                tag_or_slug=tag_slug,
                actor_id=actor_id,
                page_size=100,
            )
            samples.append(time.perf_counter() - start)
    return _summarise(label, samples)


def _summarise(label: str, samples: list[float]) -> dict[str, float]:
    """Compute p50 / p95 / p99 / mean for a sample series in ms."""
    samples_ms = sorted(s * 1000 for s in samples)
    n = len(samples_ms)
    summary = {
        "label": label,
        "n": n,
        "min_ms": samples_ms[0],
        "p50_ms": samples_ms[n // 2],
        "p95_ms": samples_ms[max(0, int(n * 0.95) - 1)],
        "p99_ms": samples_ms[max(0, int(n * 0.99) - 1)],
        "max_ms": samples_ms[-1],
        "mean_ms": statistics.fmean(samples_ms),
    }
    return summary


def _print_summary(rows: list[dict[str, float]]) -> None:
    header = (
        f"{'scenario':<46} {'n':>4} "
        f"{'min':>7} {'p50':>7} {'p95':>7} {'p99':>7} {'max':>7} {'mean':>7}"
    )
    print(header)
    print("-" * len(header))
    for row in rows:
        print(
            f"{row['label']:<46} {row['n']:>4} "
            f"{row['min_ms']:>7.2f} {row['p50_ms']:>7.2f} {row['p95_ms']:>7.2f} "
            f"{row['p99_ms']:>7.2f} {row['max_ms']:>7.2f} {row['mean_ms']:>7.2f}"
        )


async def _explain_inner_query(
    org_id: UUID, actor_id: UUID, visible_ids: list[UUID]
) -> str:
    """Run EXPLAIN ANALYZE on the outer page query with the visible set."""
    from uniffy.db.session import open_session

    if not visible_ids:
        return "no visible tag ids -- skipping EXPLAIN"
    sample = visible_ids[: min(len(visible_ids), 100)]
    in_clause = ",".join(f"'{tid}'::uuid" for tid in sample)
    sql = (
        "EXPLAIN (ANALYZE, BUFFERS) "
        "SELECT * FROM tags "
        f"WHERE organization_id = '{org_id}'::uuid "
        f"AND id IN ({in_clause}) "
        "ORDER BY last_used_at DESC NULLS LAST, id DESC "
        "LIMIT 101"
    )
    async with open_session() as session:
        rows = (await session.execute(text(sql))).all()
    return "\n".join(row[0] for row in rows)


async def run_visibility_stress(config: StressConfig) -> None:
    """End-to-end seed + bench."""
    from dotenv import load_dotenv

    from uniffy.core.search.meilisearch import close_meilisearch, init_meilisearch
    from uniffy.core.valkey.ops import close_ops_client, init_ops_client
    from uniffy.db.session import close_db, init_db, open_session

    load_dotenv()
    await init_db()
    await init_meilisearch()
    await init_ops_client()

    try:
        async with open_session() as session:
            org, users = await _resolve_org_and_users(session)
            org_id: UUID = org.id

            actor_admin = next(u for u in users if u.email == "admin@uniffy.io")
            actor_member = next(u for u in users if u.email == "alice@uniffy.io")

            existing = await _seed_existing(session, org_id)
            if existing and config.reseed:
                logger.info("Wiping previous stress seed...")
                await _wipe_seed(session, org_id)
                existing = False

            if not existing and not config.skip_seed:
                logger.info(f"Seeding {config.note_count} notes (PG + Meili)...")
                notes = await _seed_notes(
                    session, org_id, users, config.note_count
                )
                logger.info(
                    f"Seeding {config.tag_count} tags x "
                    f"{config.assignments_per_tag} assignments..."
                )
                await _seed_tags_and_assignments(
                    session,
                    org_id,
                    creator_id=actor_admin.id,
                    note_ids=[n.id for n in notes],
                    tag_count=config.tag_count,
                    assignments_per_tag=config.assignments_per_tag,
                )
            else:
                logger.info("Reusing existing stress seed.")

        # Pick a popular seed tag for list_content benches.
        from uniffy.core.models.tags.tag import Tag

        async with open_session() as session:
            popular_tag = (
                await session.execute(
                    select(Tag)
                    .where(
                        Tag.organization_id == org_id,
                        Tag.slug.like(f"{SEED_TAG_PREFIX}%"),
                    )
                    .order_by(Tag.created_at.asc())
                    .limit(1)
                )
            ).scalar_one()

        results: list[dict[str, float]] = []

        # 1. Member: list_tags cold (cache miss every iteration).
        results.append(
            await _bench_list_tags(
                org_id,
                actor_member.id,
                config.iterations,
                label="list_tags member cold",
                cold=True,
            )
        )

        # 2. Member: list_tags warm (cache hit after first iteration).
        results.append(
            await _bench_list_tags(
                org_id,
                actor_member.id,
                config.iterations,
                label="list_tags member warm",
                cold=False,
            )
        )

        # 3. Admin: list_tags warm. Should short-circuit (no predicate).
        results.append(
            await _bench_list_tags(
                org_id,
                actor_admin.id,
                config.iterations,
                label="list_tags admin warm",
                cold=False,
            )
        )

        # 4. Member: list_content cold.
        results.append(
            await _bench_list_content(
                org_id,
                actor_member.id,
                popular_tag.slug,
                config.iterations,
                label="list_content member cold",
                cold=True,
            )
        )

        # 5. Member: list_content warm.
        results.append(
            await _bench_list_content(
                org_id,
                actor_member.id,
                popular_tag.slug,
                config.iterations,
                label="list_content member warm",
                cold=False,
            )
        )

        print()
        print("=" * 80)
        print("Tag visibility cache - bench")
        print("=" * 80)
        print(
            f"Org: {org.name} ({org_id})  "
            f"actor (member): alice  actor (admin): admin"
        )
        print(
            f"Notes: {config.note_count}  Tags: {config.tag_count}  "
            f"Assignments/tag: {config.assignments_per_tag}  "
            f"Iterations: {config.iterations}"
        )
        print()
        _print_summary(results)
        print()

        # EXPLAIN on the outer page query for transparency.
        from uniffy.core.auth.permissions.visible_sets import (
            compute_visible_tag_ids,
        )

        async with open_session() as session:
            visible = await compute_visible_tag_ids(
                session, user_id=actor_member.id, organization_id=org_id
            )
        plan = await _explain_inner_query(
            org_id, actor_member.id, list(visible or [])
        )
        print("EXPLAIN (ANALYZE, BUFFERS) outer page query for member alice:")
        print(plan)
    finally:
        await close_ops_client()
        await close_meilisearch()
        await close_db()


def main() -> None:
    """Entry point for the visibility stress + bench script."""
    parser = argparse.ArgumentParser(
        description="Stress + bench the cached tag-visibility predicate.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--notes", type=int, default=1200)
    parser.add_argument("--tags", type=int, default=100)
    parser.add_argument("--assignments", type=int, default=50)
    parser.add_argument("--iterations", type=int, default=20)
    parser.add_argument("--reseed", action="store_true")
    parser.add_argument("--skip-seed", action="store_true")
    args = parser.parse_args()

    config = StressConfig(
        note_count=args.notes,
        tag_count=args.tags,
        assignments_per_tag=args.assignments,
        iterations=args.iterations,
        reseed=args.reseed,
        skip_seed=args.skip_seed,
    )
    asyncio.run(run_visibility_stress(config))


if __name__ == "__main__":
    main()
