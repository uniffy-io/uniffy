"""Reconcile note inline-tag markers with the central tag store."""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.tags.tag import Tag, TagAssignment
from uniffy.domains.tags.events import (
    EVENT_TAG_ASSIGNMENT_CHANGED,
    publish_tag_event,
)
from uniffy.domains.tags.normalize import slugify_tag
from uniffy.domains.tags.operations import _content_type_from_urn
from uniffy.domains.tags.reader import SOURCE_INLINE


@dataclass(frozen=True)
class StagedInlineTagSync:
    organization_id: UUID
    content_urn: str
    content_type: str
    added_tag_ids: tuple[UUID, ...]
    removed_tag_ids: tuple[UUID, ...]


async def sync_inline_tags(
    session: AsyncSession,
    *,
    content_urn: str,
    organization_id: UUID,
    actor_id: UUID,
    parsed_names: Iterable[str],
) -> tuple[list[UUID], list[UUID]]:
    """Reconcile and publish inline-source assignments for a content URN."""
    staged = await stage_inline_tags(
        session,
        content_urn=content_urn,
        organization_id=organization_id,
        actor_id=actor_id,
        parsed_names=parsed_names,
    )
    try:
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    await finish_inline_tags_after_commit(staged)
    return list(staged.added_tag_ids), list(staged.removed_tag_ids)


async def stage_inline_tags(
    session: AsyncSession,
    *,
    content_urn: str,
    organization_id: UUID,
    actor_id: UUID,
    parsed_names: Iterable[str],
) -> StagedInlineTagSync:
    """Reconcile inline assignments without committing the caller's transaction."""
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
        (
            await session.execute(
                select(TagAssignment).where(TagAssignment.content_urn == content_urn)
            )
        )
        .scalars()
        .all()
    )

    existing_inline_tag_ids = {row.tag_id for row in existing if SOURCE_INLINE in row.sources}
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
            update(Tag).where(Tag.id.in_([t.id for t in tags_for_slugs])).values(last_used_at=now)
        )

    await session.flush()
    return StagedInlineTagSync(
        organization_id=organization_id,
        content_urn=content_urn,
        content_type=content_type.value,
        added_tag_ids=tuple(added_tag_ids),
        removed_tag_ids=tuple(removed_tag_ids),
    )


async def finish_inline_tags_after_commit(staged: StagedInlineTagSync) -> None:
    if staged.added_tag_ids or staged.removed_tag_ids:
        await publish_tag_event(
            staged.organization_id,
            EVENT_TAG_ASSIGNMENT_CHANGED,
            {
                "content_urn": staged.content_urn,
                "content_type": staged.content_type,
                "added": [str(tid) for tid in staged.added_tag_ids],
                "removed": [str(tid) for tid in staged.removed_tag_ids],
                "source": SOURCE_INLINE,
            },
        )


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
        (
            await session.execute(
                select(Tag).where(
                    Tag.organization_id == organization_id,
                    Tag.slug.in_(list(slugs.keys())),
                )
            )
        )
        .scalars()
        .all()
    )

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
