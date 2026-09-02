"""Mutation operations for tags and assignments."""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import delete, func, literal, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.cache.operations import (
    cache_delete,
    cache_invalidate_many,
)
from uniffy.core.content.references import CONTENT_URN_PREFIX
from uniffy.core.errors import (
    ConflictError,
    NotFoundError,
    UNIFFYError,
    ValidationError,
)
from uniffy.core.models.tags.tag import Tag, TagAssignment
from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.types import AccessMode, ContentRole, ContentType
from uniffy.domains.tags.events import (
    EVENT_TAG_ASSIGNMENT_CHANGED,
    EVENT_TAG_CREATED,
    EVENT_TAG_DELETED,
    EVENT_TAG_UPDATED,
    publish_tag_event,
)
from uniffy.domains.tags.normalize import slugify_tag
from uniffy.domains.tags.reader import (
    MAX_MANUAL_TAGS_PER_CONTENT,
    RECENT_ASSIGNMENT_LIMIT,
    SOURCE_MANUAL,
    VALID_SOURCES,
    TagReader,
    count_cache_key,
)

LOGGER_COMPONENT = "tags.ops"


class TagSlugCollisionError(ConflictError):
    def __init__(self, slug: str, existing_tag_id: UUID) -> None:
        self.slug = slug
        self.existing_tag_id = existing_tag_id
        super().__init__("Tag", f"slug {slug!r} already exists")


class TagLimitExceededError(UNIFFYError):
    def __init__(self, content_urn: str, limit: int = MAX_MANUAL_TAGS_PER_CONTENT) -> None:
        self.content_urn = content_urn
        self.limit = limit
        super().__init__(f"Tag limit exceeded for {content_urn!r}: max {limit} manual tags")


@dataclass(frozen=True)
class StagedManualTagReplacement:
    organization_id: UUID
    content_urn: str
    content_type: ContentType
    current_rows: tuple[TagAssignment, ...]
    affected_tag_ids: tuple[UUID, ...]
    added_tag_ids: tuple[UUID, ...]
    removed_tag_ids: tuple[UUID, ...]


@dataclass(frozen=True)
class StagedTagRemoval:
    actor_id: UUID
    organization_id: UUID
    content_urn: str
    content_type: ContentType
    removed_tag_ids: tuple[UUID, ...]


def _content_type_from_urn(urn: str) -> ContentType:
    """Extract a ``ContentType`` from ``urn:uniffy:content:{TYPE}:{uuid}``.

    Raises ``ValidationError`` when the URN shape is wrong or the type
    segment is unknown. Tags inherit visibility from their content, so
    a typo here is a programmer error, not a permission decision.
    """
    if not urn.startswith(CONTENT_URN_PREFIX):
        raise ValidationError("content_urn", f"malformed URN {urn!r}")
    raw_type, separator, content_id = urn[len(CONTENT_URN_PREFIX) :].partition(":")
    if not separator or not content_id or content_id.count(":") > 0:
        raise ValidationError("content_urn", f"malformed URN {urn!r}")
    try:
        return ContentType(raw_type)
    except ValueError as exc:
        raise ValidationError("content_urn", f"unknown content type in {urn!r}") from exc


def _tag_urn(tag_id: UUID) -> str:
    return f"urn:uniffy:content:TAG:{tag_id}"


def _serialize_tag(tag: Tag, *, usage_count: int = 0) -> dict[str, object]:
    return {
        "id": str(tag.id),
        "organization_id": str(tag.organization_id),
        "name": tag.name,
        "slug": tag.slug,
        "color": tag.color,
        "description": tag.description,
        "created_by": str(tag.created_by) if tag.created_by else None,
        "created_at": tag.created_at.isoformat() if tag.created_at else None,
        "updated_at": tag.updated_at.isoformat() if tag.updated_at else None,
        "last_used_at": tag.last_used_at.isoformat() if tag.last_used_at else None,
        "urn": tag.urn,
        "usage_count": usage_count,
    }


class TagOperations(TagReader):
    def __init__(
        self,
        session: AsyncSession,
        search_indexer: SearchIndexer,
    ) -> None:
        super().__init__(session)
        self.indexer = search_indexer

    async def create(
        self,
        *,
        actor_id: UUID,
        organization_id: UUID,
        name: str,
        color: str | None = None,
        description: str | None = None,
    ) -> Tag:
        """First creator's ``name`` wins; later callers that hit the same
        slug get the existing row.
        """
        slug = slugify_tag(name)
        if not slug:
            raise ValidationError("name", "Tag name produces an empty slug")

        existing = await self._get_by_slug(organization_id, slug)
        if existing is not None:
            return existing

        tag = Tag(
            organization_id=organization_id,
            name=name.strip(),
            slug=slug,
            color=color,
            description=description,
            created_by=actor_id,
        )
        self.session.add(tag)
        await self.session.commit()
        await self.session.refresh(tag)

        await self._index_tag_entity(tag, usage_count=0)
        await publish_tag_event(
            organization_id,
            EVENT_TAG_CREATED,
            {"tag": _serialize_tag(tag, usage_count=0)},
        )
        return tag

    async def update(
        self,
        *,
        actor_id: UUID,
        organization_id: UUID,
        tag_id: UUID,
        name: str | None = None,
        color: str | None = None,
        description: str | None = None,
    ) -> tuple[Tag, bool]:
        """Returns ``(tag, slug_changed)``; slug collisions raise
        ``TagSlugCollisionError`` so the UI can offer a merge.
        """
        tag = await self._get_by_id(organization_id, tag_id)
        if tag is None:
            raise NotFoundError("Tag", tag_id)

        slug_changed = False
        if name is not None:
            stripped = name.strip()
            if not stripped:
                raise ValidationError("name", "Tag name cannot be empty")
            new_slug = slugify_tag(stripped)
            if not new_slug:
                raise ValidationError("name", "Tag name produces an empty slug")
            if new_slug != tag.slug:
                collision = await self._get_by_slug(organization_id, new_slug)
                if collision is not None and collision.id != tag.id:
                    raise TagSlugCollisionError(new_slug, collision.id)
                tag.slug = new_slug
                slug_changed = True
            tag.name = stripped

        if color is not None:
            tag.color = color or None

        if description is not None:
            tag.description = description or None

        tag.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(tag)

        usage_count = await self._get_usage_count(organization_id, tag.id)
        await self._index_tag_entity(tag, usage_count=usage_count)
        await publish_tag_event(
            organization_id,
            EVENT_TAG_UPDATED,
            {
                "tag": _serialize_tag(tag, usage_count=usage_count),
                "slug_changed": slug_changed,
            },
        )
        return tag, slug_changed

    async def delete(
        self,
        *,
        actor_id: UUID,
        organization_id: UUID,
        tag_id: UUID,
    ) -> list[str]:
        """Returns the URNs assigned at delete time so the caller can schedule a search reindex."""
        tag = await self._get_by_id(organization_id, tag_id)
        if tag is None:
            raise NotFoundError("Tag", tag_id)

        urns_result = await self.session.execute(
            select(TagAssignment.content_urn).where(TagAssignment.tag_id == tag_id)
        )
        urns = [row[0] for row in urns_result.all()]

        await self.session.execute(delete(TagAssignment).where(TagAssignment.tag_id == tag_id))
        tag_urn = tag.urn
        await self.session.delete(tag)
        await self.session.commit()

        await cache_delete(count_cache_key(organization_id, tag_id))
        await self._remove_tag_entity(tag_urn, organization_id)

        await publish_tag_event(
            organization_id,
            EVENT_TAG_DELETED,
            {"tag_id": str(tag_id)},
        )
        return urns

    async def assign(
        self,
        *,
        actor_id: UUID,
        organization_id: UUID,
        content_urn: str,
        tag_ids: Iterable[UUID],
        source: str = SOURCE_MANUAL,
    ) -> list[TagAssignment]:
        """Attach tags to a URN, idempotent and source-aware.

        Existing assignments add ``source`` to their ``sources`` array
        without spawning a duplicate row. Manual assignment honours the
        20-tag cap; ``inline`` is exempt to keep note saves robust.
        """
        if source not in VALID_SOURCES:
            raise ValidationError("source", f"unknown tag source {source!r}")

        content_type = _content_type_from_urn(content_urn)
        tag_id_list = [tid for tid in dict.fromkeys(tag_ids)]
        if not tag_id_list:
            return []

        tags = await self._fetch_tags(organization_id, tag_id_list)
        missing = set(tag_id_list) - {t.id for t in tags}
        if missing:
            raise NotFoundError("Tag", next(iter(missing)))

        existing_rows = await self._fetch_assignments(content_urn, tag_id_list)
        existing_by_tag = {row.tag_id: row for row in existing_rows}

        if source == SOURCE_MANUAL:
            current_manual = await self._count_manual_for_urn(content_urn)
            new_manual = sum(
                1
                for tag in tags
                if SOURCE_MANUAL
                not in (existing_by_tag[tag.id].sources if tag.id in existing_by_tag else [])
            )
            if current_manual + new_manual > MAX_MANUAL_TAGS_PER_CONTENT:
                raise TagLimitExceededError(content_urn)

        now = datetime.now(UTC)
        new_tag_ids = [tag.id for tag in tags if tag.id not in existing_by_tag]
        merged_tag_ids = [tag.id for tag in tags if tag.id in existing_by_tag]

        for tag_id in new_tag_ids:
            self.session.add(
                TagAssignment(
                    tag_id=tag_id,
                    content_urn=content_urn,
                    content_type=content_type.value,
                    sources=[source],
                    assigned_by=actor_id,
                    assigned_at=now,
                )
            )

        for tag_id in merged_tag_ids:
            assignment = existing_by_tag[tag_id]
            if source not in assignment.sources:
                assignment.sources = sorted({*assignment.sources, source})
                self.session.add(assignment)

        if tags:
            await self.session.execute(
                update(Tag).where(Tag.id.in_([t.id for t in tags])).values(last_used_at=now)
            )

        await self.session.commit()

        affected_tag_ids = [t.id for t in tags]
        await self._invalidate_counts(organization_id, affected_tag_ids)

        rows = await self._fetch_assignments(content_urn, affected_tag_ids)
        tag_counts = await self._reindex_tag_docs(organization_id, affected_tag_ids)

        await publish_tag_event(
            organization_id,
            EVENT_TAG_ASSIGNMENT_CHANGED,
            {
                "content_urn": content_urn,
                "content_type": content_type.value,
                "added": [str(tid) for tid in new_tag_ids + merged_tag_ids],
                "removed": [],
                "source": source,
                "tag_counts": {str(tid): tag_counts.get(tid, 0) for tid in affected_tag_ids},
                "tag_urns": {str(tid): _tag_urn(tid) for tid in affected_tag_ids},
            },
        )

        return rows

    async def unassign(
        self,
        *,
        actor_id: UUID,
        organization_id: UUID,
        content_urn: str,
        tag_ids: Iterable[UUID] | None = None,
        source: str | None = None,
    ) -> list[UUID]:
        """Detach tags from a URN, returning the tag ids that fully dropped.

        ``source=None`` removes the assignment regardless of source. A
        specific source removes only that source from ``sources``; when
        the array empties out, the row is deleted. ``tag_ids=None`` acts
        on every assignment for the URN.
        """
        _content_type_from_urn(content_urn)
        if source is not None and source not in VALID_SOURCES:
            raise ValidationError("source", f"unknown tag source {source!r}")

        target_ids = list(dict.fromkeys(tag_ids)) if tag_ids is not None else None
        rows = await self._fetch_assignments(content_urn, target_ids)
        if not rows:
            return []

        affected_tag_ids = {row.tag_id for row in rows}
        removed_tag_ids: list[UUID] = []

        if source is None:
            removed_tag_ids = [row.tag_id for row in rows]
            delete_stmt = delete(TagAssignment).where(
                TagAssignment.content_urn == content_urn,
                TagAssignment.tag_id.in_(removed_tag_ids),
            )
            await self.session.execute(delete_stmt)
        else:
            keep_rows: list[TagAssignment] = []
            drop_ids: list[UUID] = []
            for assignment in rows:
                if source not in assignment.sources:
                    continue
                remaining = [s for s in assignment.sources if s != source]
                if remaining:
                    assignment.sources = remaining
                    keep_rows.append(assignment)
                else:
                    drop_ids.append(assignment.tag_id)
            for assignment in keep_rows:
                self.session.add(assignment)
            if drop_ids:
                await self.session.execute(
                    delete(TagAssignment).where(
                        TagAssignment.content_urn == content_urn,
                        TagAssignment.tag_id.in_(drop_ids),
                    )
                )
                removed_tag_ids = drop_ids

        await self.session.commit()

        if removed_tag_ids:
            await self._invalidate_counts(organization_id, removed_tag_ids)

        affected_tag_ids.update(removed_tag_ids)
        affected_id_list = list(affected_tag_ids)
        tag_counts = await self._reindex_tag_docs(organization_id, affected_id_list)

        await publish_tag_event(
            organization_id,
            EVENT_TAG_ASSIGNMENT_CHANGED,
            {
                "content_urn": content_urn,
                "content_type": _content_type_from_urn(content_urn).value,
                "added": [],
                "removed": [str(tid) for tid in removed_tag_ids],
                "source": source or "",
                "actor_id": str(actor_id),
                "tag_counts": {str(tid): tag_counts.get(tid, 0) for tid in affected_id_list},
                "tag_urns": {str(tid): _tag_urn(tid) for tid in affected_id_list},
            },
        )
        return removed_tag_ids

    async def unassign_all_for_urn(
        self,
        *,
        actor_id: UUID,
        organization_id: UUID,
        content_urn: str,
    ) -> list[UUID]:
        staged = await self.stage_unassign_all_for_urn(
            actor_id=actor_id,
            organization_id=organization_id,
            content_urn=content_urn,
        )
        if not staged.removed_tag_ids:
            return []
        try:
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        return await self.finish_unassign_all_after_commit(staged)

    async def stage_unassign_all_for_urn(
        self,
        *,
        actor_id: UUID,
        organization_id: UUID,
        content_urn: str,
    ) -> StagedTagRemoval:
        rows = await self._fetch_assignments(content_urn, None)
        removed_tag_ids = tuple(row.tag_id for row in rows)
        if removed_tag_ids:
            await self.session.execute(
                delete(TagAssignment).where(TagAssignment.content_urn == content_urn)
            )
        return StagedTagRemoval(
            actor_id=actor_id,
            organization_id=organization_id,
            content_urn=content_urn,
            content_type=_content_type_from_urn(content_urn),
            removed_tag_ids=removed_tag_ids,
        )

    async def finish_unassign_all_after_commit(self, staged: StagedTagRemoval) -> list[UUID]:
        removed_tag_ids = list(staged.removed_tag_ids)
        if not removed_tag_ids:
            return []
        await self._invalidate_counts(staged.organization_id, removed_tag_ids)
        tag_counts = await self._reindex_tag_docs(staged.organization_id, removed_tag_ids)
        await publish_tag_event(
            staged.organization_id,
            EVENT_TAG_ASSIGNMENT_CHANGED,
            {
                "content_urn": staged.content_urn,
                "content_type": staged.content_type.value,
                "added": [],
                "removed": [str(tag_id) for tag_id in removed_tag_ids],
                "source": "",
                "actor_id": str(staged.actor_id),
                "tag_counts": {str(tag_id): tag_counts.get(tag_id, 0) for tag_id in removed_tag_ids},
                "tag_urns": {str(tag_id): _tag_urn(tag_id) for tag_id in removed_tag_ids},
            },
        )
        return removed_tag_ids

    async def replace_manual_tags(
        self,
        *,
        actor_id: UUID,
        organization_id: UUID,
        content_urn: str,
        tag_ids: Iterable[UUID],
    ) -> list[TagAssignment]:
        """Reconcile the manual-source tag set for a URN to ``tag_ids``.

        One transaction, one ``tag.assignment.changed`` event with
        combined ``added`` / ``removed`` lists. Domain content RPCs
        call this on every save, so the diff is applied as a single
        round of writes: source-strip + batch DELETE for falling-out
        rows, batch INSERT / merge for additions, one ``last_used_at``
        bump, one commit.
        """
        staged = await self.stage_manual_tags(
            actor_id=actor_id,
            organization_id=organization_id,
            content_urn=content_urn,
            tag_ids=tag_ids,
        )
        if not staged.affected_tag_ids:
            return list(staged.current_rows)

        try:
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        return await self.finish_manual_tags_after_commit(staged)

    async def stage_manual_tags(
        self,
        *,
        actor_id: UUID,
        organization_id: UUID,
        content_urn: str,
        tag_ids: Iterable[UUID],
    ) -> StagedManualTagReplacement:
        """Reconcile manual assignments without committing the caller's transaction."""
        desired = list(dict.fromkeys(tag_ids))
        content_type = _content_type_from_urn(content_urn)

        if desired:
            tags = await self._fetch_tags(organization_id, desired)
            missing = set(desired) - {t.id for t in tags}
            if missing:
                raise NotFoundError("Tag", next(iter(missing)))

        current_rows = await self._fetch_assignments(content_urn, None)
        current_by_tag = {row.tag_id: row for row in current_rows}
        current_manual_ids = {row.tag_id for row in current_rows if SOURCE_MANUAL in row.sources}
        desired_set = set(desired)

        to_remove = current_manual_ids - desired_set
        to_add = [tid for tid in desired if tid not in current_manual_ids]

        resulting_manual = len(current_manual_ids) - len(to_remove) + len(to_add)
        if resulting_manual > MAX_MANUAL_TAGS_PER_CONTENT:
            raise TagLimitExceededError(content_urn)

        if not to_remove and not to_add:
            return StagedManualTagReplacement(
                organization_id=organization_id,
                content_urn=content_urn,
                content_type=content_type,
                current_rows=tuple(current_rows),
                affected_tag_ids=(),
                added_tag_ids=(),
                removed_tag_ids=(),
            )

        now = datetime.now(UTC)
        affected_tag_ids: set[UUID] = set()
        removed_tag_ids: list[UUID] = []
        added_tag_ids: list[UUID] = []

        rows_to_drop: list[UUID] = []
        for tag_id in to_remove:
            row = current_by_tag[tag_id]
            remaining = [s for s in row.sources if s != SOURCE_MANUAL]
            if remaining:
                row.sources = remaining
                self.session.add(row)
            else:
                rows_to_drop.append(tag_id)
            affected_tag_ids.add(tag_id)

        if rows_to_drop:
            await self.session.execute(
                delete(TagAssignment).where(
                    TagAssignment.content_urn == content_urn,
                    TagAssignment.tag_id.in_(rows_to_drop),
                )
            )
            removed_tag_ids.extend(rows_to_drop)

        for tag_id in to_add:
            existing = current_by_tag.get(tag_id)
            if existing is None:
                self.session.add(
                    TagAssignment(
                        tag_id=tag_id,
                        content_urn=content_urn,
                        content_type=content_type.value,
                        sources=[SOURCE_MANUAL],
                        assigned_by=actor_id,
                        assigned_at=now,
                    )
                )
            elif SOURCE_MANUAL not in existing.sources:
                existing.sources = sorted({*existing.sources, SOURCE_MANUAL})
                self.session.add(existing)
            affected_tag_ids.add(tag_id)
            added_tag_ids.append(tag_id)

        if affected_tag_ids:
            await self.session.execute(
                update(Tag).where(Tag.id.in_(list(affected_tag_ids))).values(last_used_at=now)
            )

        return StagedManualTagReplacement(
            organization_id=organization_id,
            content_urn=content_urn,
            content_type=content_type,
            current_rows=tuple(current_rows),
            affected_tag_ids=tuple(affected_tag_ids),
            added_tag_ids=tuple(added_tag_ids),
            removed_tag_ids=tuple(removed_tag_ids),
        )

    async def finish_manual_tags_after_commit(
        self,
        staged: StagedManualTagReplacement,
    ) -> list[TagAssignment]:
        if not staged.affected_tag_ids:
            return list(staged.current_rows)

        await self._invalidate_counts(staged.organization_id, staged.affected_tag_ids)
        affected_id_list = list(staged.affected_tag_ids)
        tag_counts = await self._reindex_tag_docs(staged.organization_id, affected_id_list)

        await publish_tag_event(
            staged.organization_id,
            EVENT_TAG_ASSIGNMENT_CHANGED,
            {
                "content_urn": staged.content_urn,
                "content_type": staged.content_type.value,
                "added": [str(tid) for tid in staged.added_tag_ids],
                "removed": [str(tid) for tid in staged.removed_tag_ids],
                "source": SOURCE_MANUAL,
                "tag_counts": {str(tid): tag_counts.get(tid, 0) for tid in affected_id_list},
                "tag_urns": {str(tid): _tag_urn(tid) for tid in affected_id_list},
            },
        )

        return await self._fetch_assignments(staged.content_urn, None)

    async def merge_tags(
        self,
        *,
        actor_id: UUID,
        organization_id: UUID,
        source_tag_id: UUID,
        target_tag_id: UUID,
    ) -> Tag:
        """Move every assignment from ``source`` to ``target`` and drop ``source``.

        Three round-trips: an ``INSERT ... SELECT ... ON CONFLICT DO
        UPDATE SET sources = ARRAY(DISTINCT unnest(...))`` folds the
        source rows into the target row-set in a single indexed scan,
        followed by a bulk DELETE of the source rows and a final DELETE
        of the source tag.

        ``moved_urn_count`` in the realtime payload comes from the
        INSERT's ``RETURNING`` so the count reflects rows that actually
        moved (target may already carry some of the same URNs).
        """
        if source_tag_id == target_tag_id:
            raise ValidationError("source_tag_id", "Cannot merge tag into itself")

        source = await self._get_by_id(organization_id, source_tag_id)
        if source is None:
            raise NotFoundError("Tag", source_tag_id)
        target = await self._get_by_id(organization_id, target_tag_id)
        if target is None:
            raise NotFoundError("Tag", target_tag_id)

        select_source = select(
            literal(target_tag_id).label("tag_id"),
            TagAssignment.content_urn,
            TagAssignment.content_type,
            TagAssignment.sources,
            TagAssignment.assigned_by,
            TagAssignment.assigned_at,
        ).where(TagAssignment.tag_id == source_tag_id)
        insert_stmt = pg_insert(TagAssignment.__table__).from_select(
            ["tag_id", "content_urn", "content_type", "sources", "assigned_by", "assigned_at"],
            select_source,
        )
        upsert = insert_stmt.on_conflict_do_update(
            index_elements=["tag_id", "content_urn"],
            set_={
                "sources": text(
                    "ARRAY(SELECT DISTINCT unnest(tag_assignments.sources || EXCLUDED.sources))"
                ),
            },
        ).returning(TagAssignment.__table__.c.content_urn)

        moved_rows = (await self.session.execute(upsert)).all()
        moved_count = len(moved_rows)

        await self.session.execute(
            delete(TagAssignment).where(TagAssignment.tag_id == source_tag_id)
        )

        source_urn = source.urn
        await self.session.execute(
            delete(Tag).where(
                Tag.id == source_tag_id,
                Tag.organization_id == organization_id,
            )
        )
        await self.session.commit()
        await self.session.refresh(target)

        await cache_delete(count_cache_key(organization_id, source_tag_id))
        await cache_delete(count_cache_key(organization_id, target_tag_id))

        await self._remove_tag_entity(source_urn, organization_id)
        target_counts = await self._reindex_tag_docs(organization_id, [target_tag_id])
        usage_count = target_counts.get(target_tag_id, 0)

        await publish_tag_event(
            organization_id,
            EVENT_TAG_DELETED,
            {"tag_id": str(source_tag_id)},
        )
        await publish_tag_event(
            organization_id,
            EVENT_TAG_UPDATED,
            {
                "tag": _serialize_tag(target, usage_count=usage_count),
                "merged_from": str(source_tag_id),
                "moved_urn_count": moved_count,
            },
        )

        if moved_count:
            logger.info(
                f"merged {moved_count} assignments from {source_tag_id} into {target_tag_id}",
                component=LOGGER_COMPONENT,
            )
        return target

    async def _index_tag_entity(
        self,
        tag: Tag,
        *,
        usage_count: int,
        breakdown_data: tuple[dict[str, int], list[str], list[str]] | None = None,
    ) -> None:
        """Index org-visible tag previews while preserving read-time assignment privacy."""
        owner_id = tag.created_by or tag.organization_id
        url_path = f"/tags/{tag.slug}"
        keywords = " ".join(filter(None, [tag.name, tag.slug, tag.description or ""]))
        if breakdown_data is None:
            breakdown, recent_urns, recent_at = await self._compute_tag_breakdown(tag.id)
        else:
            breakdown, recent_urns, recent_at = breakdown_data
        metadata = {
            "slug": tag.slug,
            "color": tag.color or "",
            "usage_count": str(usage_count),
            "usage_count_by_domain": _format_breakdown(breakdown),
            "recent_assignment_urns": _format_pipes(recent_urns),
            "recent_assignment_at": _format_pipes(recent_at),
            "created_by": str(tag.created_by) if tag.created_by else "",
        }
        await self.indexer.index(
            urn=tag.urn,
            organization_id=tag.organization_id,
            title=tag.name,
            entity_type="tag",
            url_path=url_path,
            owner_id=owner_id,
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.VIEWER,
            keywords=keywords,
            description=tag.description,
            metadata=metadata,
        )

    async def _reindex_tag_docs(
        self,
        organization_id: UUID,
        tag_ids: Iterable[UUID],
    ) -> dict[UUID, int]:
        """Refresh bounded tag previews inline and return their usage counts."""
        ids = list(dict.fromkeys(tag_ids))
        if not ids:
            return {}
        tags = await self._fetch_tags(organization_id, ids)
        counts = await self._get_usage_counts(organization_id, ids)
        for tag in tags:
            breakdown_data = await self._compute_tag_breakdown(tag.id)
            await self._index_tag_entity(
                tag,
                usage_count=counts.get(tag.id, 0),
                breakdown_data=breakdown_data,
            )
        return counts

    async def _compute_tag_breakdown(
        self, tag_id: UUID
    ) -> tuple[dict[str, int], list[str], list[str]]:
        """Build the denormalized stats needed to resolve a tag chip without another query."""
        breakdown_stmt = (
            select(TagAssignment.content_type, func.count())
            .where(TagAssignment.tag_id == tag_id)
            .group_by(TagAssignment.content_type)
        )
        breakdown_rows = (await self.session.execute(breakdown_stmt)).all()
        breakdown = {row[0]: int(row[1]) for row in breakdown_rows}

        recent_stmt = (
            select(TagAssignment.content_urn, TagAssignment.assigned_at)
            .where(TagAssignment.tag_id == tag_id)
            .order_by(TagAssignment.assigned_at.desc())
            .limit(RECENT_ASSIGNMENT_LIMIT)
        )
        recent_rows = (await self.session.execute(recent_stmt)).all()
        recent_urns = [row[0] for row in recent_rows]
        recent_at = [row[1].isoformat() if row[1] is not None else "" for row in recent_rows]
        return breakdown, recent_urns, recent_at

    async def _remove_tag_entity(self, tag_urn: str, organization_id: UUID) -> None:
        await self.indexer.remove(tag_urn, organization_id)

    async def _invalidate_counts(
        self,
        organization_id: UUID,
        tag_ids: Iterable[UUID],
    ) -> None:
        keys = [count_cache_key(organization_id, tag_id) for tag_id in dict.fromkeys(tag_ids)]
        if keys:
            await cache_invalidate_many(*keys)


def _format_breakdown(breakdown: dict[str, int]) -> str:
    """Pipe-encode a per-domain usage breakdown for search metadata."""
    if not breakdown:
        return ""
    return "|".join(
        f"{ct}:{count}" for ct, count in sorted(breakdown.items(), key=lambda kv: -kv[1])
    )


def _format_pipes(values: list[str]) -> str:
    """Pipe-encode a parallel-array field. Empty when no entries."""
    return "|".join(values) if values else ""
