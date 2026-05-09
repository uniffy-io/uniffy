"""Inline-tag reconciliation helpers.

Notes parse ``[[[tag|name]]]`` markers out of markdown / canvas content.
This module reconciles those parsed names with the central tags store
so the same tag namespace serves both the inline source (notes) and
the manual source (every other domain).

Reconciliation rules
--------------------
- Each parsed name normalizes to a slug. Unknown slugs spawn new
  ``Tag`` rows with ``created_by = actor_id``.
- For each name we add ``inline`` to the assignment's ``sources``.
- Assignments that previously carried ``inline`` but whose tag is no
  longer parsed have ``inline`` stripped. If the resulting ``sources``
  is empty, the row is deleted; otherwise the row stays alive (the
  manual side still references it).
- The 20-tag manual cap does not apply to inline syncing — exceeding
  the cap should never break a note save.
"""

from collections.abc import Iterable
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.tags.tag import Tag, TagAssignment
from uniffy.core.valkey.tags import (
    EVENT_TAG_ASSIGNMENT_CHANGED,
    publish_tag_event,
)
from uniffy.domains.tags.normalize import slugify_tag
from uniffy.domains.tags.operations import (
    SOURCE_INLINE,
    _content_type_from_urn,
)


async def sync_inline_tags(
    session: AsyncSession,
    *,
    content_urn: str,
    organization_id: UUID,
    actor_id: UUID,
    parsed_names: Iterable[str],
) -> tuple[list[UUID], list[UUID]]:
    """Reconcile inline-source assignments for a content URN.

    Returns ``(added_tag_ids, removed_tag_ids)`` for diagnostic and
    realtime purposes. The caller is responsible for committing
    upstream context (the surrounding note save) -- this helper writes
    its own commit before publishing.
    """
    content_type = _content_type_from_urn(content_urn)

    desired_slugs: dict[str, str] = {}
    for raw in parsed_names:
        slug = slugify_tag(raw)
        if not slug:
            continue
        desired_slugs.setdefault(slug, raw.strip())

    tags_for_slugs = await _ensure_tags(
        session,
        organization_id=organization_id,
        actor_id=actor_id,
        slugs=desired_slugs,
    )
    desired_tag_ids = {tag.id for tag in tags_for_slugs}

    existing = (
        await session.execute(
            select(TagAssignment).where(TagAssignment.content_urn == content_urn)
        )
    ).scalars().all()

    existing_inline_tag_ids = {
        row.tag_id for row in existing if SOURCE_INLINE in row.sources
    }
    existing_by_tag = {row.tag_id: row for row in existing}

    added_tag_ids: list[UUID] = []
    removed_tag_ids: list[UUID] = []
    now = datetime.now(UTC)

    for tag in tags_for_slugs:
        existing_row = existing_by_tag.get(tag.id)
        if existing_row is None:
            session.add(
                TagAssignment(
                    tag_id=tag.id,
                    content_urn=content_urn,
                    content_type=content_type.value,
                    sources=[SOURCE_INLINE],
                    assigned_by=actor_id,
                    assigned_at=now,
                )
            )
            added_tag_ids.append(tag.id)
        elif SOURCE_INLINE not in existing_row.sources:
            existing_row.sources = sorted({*existing_row.sources, SOURCE_INLINE})
            session.add(existing_row)
            added_tag_ids.append(tag.id)

    for tag_id in existing_inline_tag_ids - desired_tag_ids:
        row = existing_by_tag[tag_id]
        remaining = [s for s in row.sources if s != SOURCE_INLINE]
        if remaining:
            row.sources = remaining
            session.add(row)
        else:
            await session.delete(row)
        removed_tag_ids.append(tag_id)

    if tags_for_slugs:
        await session.execute(
            update(Tag)
            .where(Tag.id.in_([t.id for t in tags_for_slugs]))
            .values(last_used_at=now)
        )

    await session.commit()

    if added_tag_ids or removed_tag_ids:
        await publish_tag_event(
            organization_id,
            EVENT_TAG_ASSIGNMENT_CHANGED,
            {
                "content_urn": content_urn,
                "content_type": content_type.value,
                "added": [str(tid) for tid in added_tag_ids],
                "removed": [str(tid) for tid in removed_tag_ids],
                "source": SOURCE_INLINE,
            },
        )

    return added_tag_ids, removed_tag_ids


async def _ensure_tags(
    session: AsyncSession,
    *,
    organization_id: UUID,
    actor_id: UUID,
    slugs: dict[str, str],
) -> list[Tag]:
    """Resolve every desired slug to a tag row, creating missing ones."""
    if not slugs:
        return []

    existing_rows = (
        await session.execute(
            select(Tag).where(
                Tag.organization_id == organization_id,
                Tag.slug.in_(list(slugs.keys())),
            )
        )
    ).scalars().all()

    by_slug = {tag.slug: tag for tag in existing_rows}

    for slug, name in slugs.items():
        if slug in by_slug:
            continue
        tag = Tag(
            organization_id=organization_id,
            name=name or slug,
            slug=slug,
            created_by=actor_id,
        )
        session.add(tag)
        by_slug[slug] = tag

    await session.flush()
    return list(by_slug.values())
