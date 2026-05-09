"""Tag operations.

Single facade owning all reads and writes against ``tags`` /
``tag_assignments``. Domain code (notes, files, calendar, chat, agents,
projects, the explorer) routes through this class so behaviour stays
consistent across the application.

Design choices
--------------
- Counts are cached in Valkey (60s TTL), invalidated on writes. There
  is no ``usage_count`` column.
- ``assign`` enforces a hard 20-tag cap on ``source=manual``. Inline
  syncing is exempt because note save flows must never hard-fail when
  an author types many ``[[[tag|x]]]`` markers.
- ``sources`` is a string array. Adding a manual assignment to a
  previously inline-only tag adds ``"manual"`` without duplicating the
  row. Removing one source from a row with both keeps the row alive.
- Every write publishes a Valkey event after the DB commit so the
  explorer dashboard, mention chips, and notification stream can react
  in near-real-time.
- ``merge_tags`` is one transaction: assignments fold via
  ``ON CONFLICT DO UPDATE SET sources = ARRAY(DISTINCT ...)`` and the
  source tag drops out cleanly.
"""

from collections.abc import Iterable
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, delete, exists, func, literal, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions import invalidate_visible_sets_for_org
from uniffy.core.errors import (
    ConflictError,
    NotFoundError,
    UNIFFYError,
    ValidationError,
)
from uniffy.core.models.tags.tag import Tag, TagAssignment
from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.types import AccessMode, ContentRole, ContentType
from uniffy.core.valkey.cache import (
    cache_delete,
    cache_get_many,
    cache_get_or_set_locked,
    cache_invalidate_many,
    cache_set,
)
from uniffy.core.valkey.tags import (
    EVENT_TAG_ASSIGNMENT_CHANGED,
    EVENT_TAG_CREATED,
    EVENT_TAG_DELETED,
    EVENT_TAG_UPDATED,
    publish_tag_event,
)
from uniffy.domains.tags.normalize import slugify_tag
from uniffy.domains.tags.visibility import (
    build_assignment_visibility_predicate,
    build_tag_visibility_predicate,
)

LOGGER_COMPONENT = "tags.ops"

SOURCE_MANUAL = "manual"
SOURCE_INLINE = "inline"
_VALID_SOURCES = frozenset({SOURCE_MANUAL, SOURCE_INLINE})

MAX_MANUAL_TAGS_PER_CONTENT = 20

_COUNT_CACHE_TTL = 60
_COUNT_CACHE_PREFIX = "tag_count"

_DEFAULT_PAGE_SIZE = 100
_MAX_PAGE_SIZE = 500
_DEFAULT_SUGGEST_LIMIT = 10
_MAX_SUGGEST_LIMIT = 50

_RECENT_ASSIGNMENT_LIMIT = 5


class TagSlugCollisionError(ConflictError):
    """Rename / create would collide with an existing slug in the org."""

    def __init__(self, slug: str, existing_tag_id: UUID) -> None:
        self.slug = slug
        self.existing_tag_id = existing_tag_id
        super().__init__("Tag", f"slug {slug!r} already exists")


class TagLimitExceededError(UNIFFYError):
    """Manual tag cap exceeded for a content URN."""

    def __init__(self, content_urn: str, limit: int = MAX_MANUAL_TAGS_PER_CONTENT) -> None:
        self.content_urn = content_urn
        self.limit = limit
        super().__init__(
            f"Tag limit exceeded for {content_urn!r}: max {limit} manual tags"
        )


def _content_type_from_urn(urn: str) -> ContentType:
    """Extract a ``ContentType`` from ``urn:uniffy:content:{TYPE}:{uuid}``.

    Raises ``ValidationError`` when the URN shape is wrong or the type
    segment is unknown. Tags inherit visibility from their content, so
    a typo here is a programmer error, not a permission decision.
    """
    parts = urn.split(":")
    if len(parts) != 5 or parts[0] != "urn" or parts[1] != "uniffy" or parts[2] != "content":
        raise ValidationError("content_urn", f"malformed URN {urn!r}")
    try:
        return ContentType(parts[3])
    except ValueError as exc:
        raise ValidationError("content_urn", f"unknown content type in {urn!r}") from exc


def _count_cache_key(organization_id: UUID, tag_id: UUID) -> str:
    return f"{_COUNT_CACHE_PREFIX}:{organization_id}:{tag_id}"


def _tag_urn(tag_id: UUID) -> str:
    return f"urn:uniffy:content:TAG:{tag_id}"


def _serialize_tag(tag: Tag, *, usage_count: int = 0) -> dict[str, object]:
    """Build the realtime payload representation of a tag."""
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


class TagOperations:
    """Business logic for the unified tags namespace."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.indexer = SearchIndexer()

    async def create(
        self,
        *,
        actor_id: UUID,
        organization_id: UUID,
        name: str,
        color: str | None = None,
        description: str | None = None,
    ) -> Tag:
        """Create a tag, or return the existing row when the slug matches.

        Slug is derived from ``name``. The first creator's ``name`` wins
        for display; later callers that hit the same slug get the
        existing row back unchanged.
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
        await invalidate_visible_sets_for_org(organization_id)
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
        """Rename / recolor / re-describe a tag.

        Returns ``(tag, slug_changed)``. The slug-changed flag lets the
        caller schedule a search reindex of every tagged URN: a renamed
        tag's ``tag:{slug}`` keyword changes on every document in the
        index, and the rename RPC must not block on that fan-out.

        Renaming may change the slug; collision raises
        ``TagSlugCollisionError`` so the caller (UI) can offer a merge.
        ``actor_id`` is accepted for future audit hooks but is not
        currently persisted on the row beyond the existing
        ``created_by`` field.
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
        """Delete a tag and cascade its assignments.

        Returns the list of content URNs that were assigned the tag at
        delete time so the caller can schedule a search reindex (a
        renamed tag changes the ``tag:{slug}`` keyword on every tagged
        document).
        """
        tag = await self._get_by_id(organization_id, tag_id)
        if tag is None:
            raise NotFoundError("Tag", tag_id)

        urns_result = await self.session.execute(
            select(TagAssignment.content_urn).where(TagAssignment.tag_id == tag_id)
        )
        urns = [row[0] for row in urns_result.all()]

        await self.session.execute(
            delete(TagAssignment).where(TagAssignment.tag_id == tag_id)
        )
        tag_urn = tag.urn
        await self.session.delete(tag)
        await self.session.commit()

        await cache_delete(_count_cache_key(organization_id, tag_id))
        await self._remove_tag_entity(tag_urn, organization_id)
        await invalidate_visible_sets_for_org(organization_id)

        await publish_tag_event(
            organization_id,
            EVENT_TAG_DELETED,
            {"tag_id": str(tag_id)},
        )
        return urns

    async def get(
        self,
        *,
        organization_id: UUID,
        tag_or_slug: str,
        actor_id: UUID | None = None,
    ) -> Tag:
        """Resolve a tag by id (UUID string) or slug. Raises NotFoundError.

        When ``actor_id`` is set the tag is hidden -- as ``NotFoundError`` --
        from users who cannot prove visibility on it. Resolving to 404
        instead of 403 prevents id / slug enumeration.
        """
        try:
            tag_uuid = UUID(tag_or_slug)
        except ValueError:
            tag_uuid = None

        tag: Tag | None = None
        if tag_uuid is not None:
            tag = await self._get_by_id(organization_id, tag_uuid)

        if tag is None:
            tag = await self._get_by_slug(organization_id, slugify_tag(tag_or_slug))

        if tag is None:
            raise NotFoundError("Tag", tag_or_slug)

        if actor_id is not None:
            if not await self._tag_visible_via_predicate(actor_id, organization_id, tag.id):
                raise NotFoundError("Tag", tag_or_slug)
        return tag

    async def _tag_visible_via_predicate(
        self,
        actor_id: UUID,
        organization_id: UUID,
        tag_id: UUID,
    ) -> bool:
        """Single-tag visibility check using the SQL predicate.

        One round-trip: ``SELECT 1 FROM tags WHERE id = ? AND <predicate>``.
        Org admin short-circuits server-side via the predicate builder.
        """
        predicate = await build_tag_visibility_predicate(
            self.session,
            user_id=actor_id,
            organization_id=organization_id,
        )
        if predicate is None:
            return True
        stmt = select(Tag.id).where(
            Tag.id == tag_id,
            Tag.organization_id == organization_id,
            predicate,
        )
        return (await self.session.execute(stmt)).scalar_one_or_none() is not None

    async def list_tags(
        self,
        *,
        organization_id: UUID,
        content_types: Iterable[ContentType] | None = None,
        query: str | None = None,
        sort: str = "recent_desc",
        page_size: int = _DEFAULT_PAGE_SIZE,
        page_token: str | None = None,
        actor_id: UUID | None = None,
    ) -> tuple[list[Tag], dict[UUID, int], str | None]:
        """Page through tags in the org with optional substring search.

        Returns ``(tags, counts_by_id, next_page_token)``. The counts
        dict is hydrated for the returned page only.

        When ``actor_id`` is supplied the page is filtered server-side
        via :func:`build_tag_visibility_predicate` so the SQL planner
        short-circuits per row. Org / domain admins skip the predicate
        entirely. Pagination is deterministic -- no over-fetch shrink.
        """
        page_size = max(1, min(page_size, _MAX_PAGE_SIZE))
        offset = _decode_offset(page_token)

        visibility_predicate = None
        if actor_id is not None:
            visibility_predicate = await build_tag_visibility_predicate(
                self.session,
                user_id=actor_id,
                organization_id=organization_id,
            )

        stmt = select(Tag).where(Tag.organization_id == organization_id)

        if query:
            needle = f"{query.strip().lower()}%"
            stmt = stmt.where(
                or_(func.lower(Tag.name).like(needle), Tag.slug.like(needle))
            )

        if content_types:
            content_type_values = [ct.value for ct in content_types]
            stmt = stmt.where(
                exists(
                    select(1)
                    .select_from(TagAssignment)
                    .where(
                        TagAssignment.tag_id == Tag.id,
                        TagAssignment.content_type.in_(content_type_values),
                    )
                )
            )

        if visibility_predicate is not None:
            stmt = stmt.where(visibility_predicate)

        if sort == "alpha_asc":
            stmt = stmt.order_by(Tag.name.asc(), Tag.id.asc())
        elif sort == "alpha_desc":
            stmt = stmt.order_by(Tag.name.desc(), Tag.id.desc())
        elif sort == "recent_desc":
            stmt = stmt.order_by(
                Tag.last_used_at.desc().nullslast(),
                Tag.id.desc(),
            )
        else:
            stmt = stmt.order_by(Tag.id.desc())

        stmt = stmt.offset(offset).limit(page_size + 1)
        rows = (await self.session.execute(stmt)).scalars().all()
        has_more = len(rows) > page_size
        tags = list(rows[:page_size])

        counts = await self._get_usage_counts(organization_id, [t.id for t in tags])

        next_token = _encode_offset(offset + page_size) if has_more else None
        return tags, counts, next_token

    async def suggest(
        self,
        *,
        organization_id: UUID,
        prefix: str,
        limit: int = _DEFAULT_SUGGEST_LIMIT,
        actor_id: UUID | None = None,
    ) -> list[Tag]:
        """Return tags whose slug starts with ``prefix`` ordered by recency.

        When ``actor_id`` is supplied the result is filtered to tags the
        user can currently see -- the worst leak surface, since two
        characters of input are enough to enumerate confidential prefixes.
        """
        slug_prefix = slugify_tag(prefix)
        if not slug_prefix:
            return []
        limit = max(1, min(limit, _MAX_SUGGEST_LIMIT))

        visibility_predicate = None
        if actor_id is not None:
            visibility_predicate = await build_tag_visibility_predicate(
                self.session,
                user_id=actor_id,
                organization_id=organization_id,
            )

        stmt = (
            select(Tag)
            .where(
                Tag.organization_id == organization_id,
                Tag.slug.like(f"{slug_prefix}%"),
            )
            .order_by(Tag.last_used_at.desc().nullslast(), Tag.name.asc())
            .limit(limit)
        )
        if visibility_predicate is not None:
            stmt = stmt.where(visibility_predicate)
        rows = list((await self.session.execute(stmt)).scalars().all())

        return rows

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
        if source not in _VALID_SOURCES:
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
                not in (
                    existing_by_tag[tag.id].sources
                    if tag.id in existing_by_tag
                    else []
                )
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
                update(Tag)
                .where(Tag.id.in_([t.id for t in tags]))
                .values(last_used_at=now)
            )

        await self.session.commit()

        affected_tag_ids = [t.id for t in tags]
        await self._invalidate_counts(organization_id, affected_tag_ids)
        await invalidate_visible_sets_for_org(organization_id)

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
        if source is not None and source not in _VALID_SOURCES:
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
        await invalidate_visible_sets_for_org(organization_id)

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
                "tag_counts": {str(tid): tag_counts.get(tid, 0) for tid in affected_id_list},
                "tag_urns": {str(tid): _tag_urn(tid) for tid in affected_id_list},
            },
        )
        return removed_tag_ids

    async def unassign_all_for_urn(
        self,
        *,
        organization_id: UUID,
        content_urn: str,
    ) -> list[UUID]:
        """Drop every assignment pointing at a URN. Called on content delete."""
        return await self.unassign(
            organization_id=organization_id,
            content_urn=content_urn,
            tag_ids=None,
            source=None,
        )

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
        desired = list(dict.fromkeys(tag_ids))
        content_type = _content_type_from_urn(content_urn)

        if desired:
            tags = await self._fetch_tags(organization_id, desired)
            missing = set(desired) - {t.id for t in tags}
            if missing:
                raise NotFoundError("Tag", next(iter(missing)))

        current_rows = await self._fetch_assignments(content_urn, None)
        current_by_tag = {row.tag_id: row for row in current_rows}
        current_manual_ids = {
            row.tag_id for row in current_rows if SOURCE_MANUAL in row.sources
        }
        desired_set = set(desired)

        to_remove = current_manual_ids - desired_set
        to_add = [tid for tid in desired if tid not in current_manual_ids]

        resulting_manual = (
            len(current_manual_ids) - len(to_remove) + len(to_add)
        )
        if resulting_manual > MAX_MANUAL_TAGS_PER_CONTENT:
            raise TagLimitExceededError(content_urn)

        if not to_remove and not to_add:
            return current_rows

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
                update(Tag)
                .where(Tag.id.in_(list(affected_tag_ids)))
                .values(last_used_at=now)
            )

        await self.session.commit()

        if affected_tag_ids:
            await self._invalidate_counts(organization_id, affected_tag_ids)
        await invalidate_visible_sets_for_org(organization_id)
        affected_id_list = list(affected_tag_ids)
        tag_counts = await self._reindex_tag_docs(organization_id, affected_id_list)

        await publish_tag_event(
            organization_id,
            EVENT_TAG_ASSIGNMENT_CHANGED,
            {
                "content_urn": content_urn,
                "content_type": content_type.value,
                "added": [str(tid) for tid in added_tag_ids],
                "removed": [str(tid) for tid in removed_tag_ids],
                "source": SOURCE_MANUAL,
                "tag_counts": {str(tid): tag_counts.get(tid, 0) for tid in affected_id_list},
                "tag_urns": {str(tid): _tag_urn(tid) for tid in affected_id_list},
            },
        )

        return await self._fetch_assignments(content_urn, None)

    async def get_for_urns(
        self,
        *,
        organization_id: UUID,
        content_urns: Iterable[str],
    ) -> dict[str, list[Tag]]:
        """Bulk-fetch the tags applied to each URN.

        Used by domain list endpoints to hydrate ``tags[]`` without
        N+1 queries. Returns a mapping with an entry for every input
        URN (empty list when no tags are attached).
        """
        urn_list = list(dict.fromkeys(content_urns))
        result: dict[str, list[Tag]] = {urn: [] for urn in urn_list}
        if not urn_list:
            return result

        stmt = (
            select(TagAssignment.content_urn, Tag)
            .join(Tag, Tag.id == TagAssignment.tag_id)
            .where(
                Tag.organization_id == organization_id,
                TagAssignment.content_urn.in_(urn_list),
            )
            .order_by(TagAssignment.assigned_at.asc())
        )
        rows = (await self.session.execute(stmt)).all()
        for urn, tag in rows:
            result[urn].append(tag)
        return result

    async def list_content(
        self,
        *,
        organization_id: UUID,
        tag_or_slug: str,
        content_types: Iterable[ContentType] | None = None,
        additional_tag_ids: Iterable[UUID] | None = None,
        sources: Iterable[str] | None = None,
        page_size: int = _DEFAULT_PAGE_SIZE,
        page_token: str | None = None,
        actor_id: UUID | None = None,
    ) -> tuple[list[TagAssignment], str | None]:
        """Page assignments for a tag, narrowed by the explorer criteria.

        Returns the raw assignments; the caller hydrates each URN to
        its domain row via the existing search index or a direct
        lookup.

        When ``actor_id`` is supplied the tag itself is gated through
        :func:`build_tag_visibility_predicate` (404 on invisible) and
        individual assignment rows are filtered server-side via
        :func:`build_assignment_visibility_predicate` so a row whose
        content the actor cannot view never reaches Python.
        ``additional_tag_ids`` adds an AND constraint -- the URN must
        also carry every listed tag. ``sources`` filters the primary
        assignment row's ``sources`` array (subset semantics: any
        listed source matches).
        """
        tag = await self.get(
            organization_id=organization_id,
            tag_or_slug=tag_or_slug,
            actor_id=actor_id,
        )
        page_size = max(1, min(page_size, _MAX_PAGE_SIZE))
        offset = _decode_offset(page_token)

        stmt = select(TagAssignment).where(TagAssignment.tag_id == tag.id)
        if content_types:
            stmt = stmt.where(
                TagAssignment.content_type.in_([ct.value for ct in content_types])
            )
        if sources:
            valid = [s for s in sources if s in _VALID_SOURCES]
            if valid:
                stmt = stmt.where(TagAssignment.sources.overlap(valid))
        extra = [tid for tid in (additional_tag_ids or []) if tid != tag.id]
        if extra:
            stmt = stmt.where(
                TagAssignment.content_urn.in_(
                    select(TagAssignment.content_urn)
                    .where(TagAssignment.tag_id.in_(extra))
                    .group_by(TagAssignment.content_urn)
                    .having(func.count(TagAssignment.tag_id.distinct()) == len(extra))
                )
            )
        if actor_id is not None:
            assignment_predicate = await build_assignment_visibility_predicate(
                self.session,
                user_id=actor_id,
                organization_id=organization_id,
            )
            if assignment_predicate is not None:
                stmt = stmt.where(assignment_predicate)

        stmt = stmt.order_by(
            TagAssignment.assigned_at.desc(),
            TagAssignment.content_urn.asc(),
        )
        stmt = stmt.offset(offset).limit(page_size + 1)

        rows = list((await self.session.execute(stmt)).scalars().all())
        has_more = len(rows) > page_size
        assignments = rows[:page_size]

        next_token = _encode_offset(offset + page_size) if has_more else None
        return assignments, next_token

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

        select_source = (
            select(
                literal(target_tag_id).label("tag_id"),
                TagAssignment.content_urn,
                TagAssignment.content_type,
                TagAssignment.sources,
                TagAssignment.assigned_by,
                TagAssignment.assigned_at,
            ).where(TagAssignment.tag_id == source_tag_id)
        )
        insert_stmt = pg_insert(TagAssignment.__table__).from_select(
            ["tag_id", "content_urn", "content_type", "sources", "assigned_by", "assigned_at"],
            select_source,
        )
        upsert = insert_stmt.on_conflict_do_update(
            index_elements=["tag_id", "content_urn"],
            set_={
                "sources": text(
                    "ARRAY(SELECT DISTINCT unnest("
                    "tag_assignments.sources || EXCLUDED.sources))"
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

        await cache_delete(_count_cache_key(organization_id, source_tag_id))
        await cache_delete(_count_cache_key(organization_id, target_tag_id))
        await invalidate_visible_sets_for_org(organization_id)

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
                f"merged {moved_count} assignments from {source_tag_id} "
                f"into {target_tag_id}",
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
        """Write the tag's Meilisearch document.

        Tags are org-wide entities; visibility maps to ``OPEN_TO_ORG``
        with a ``VIEWER`` baseline so every org member can resolve them
        in spotlight / mention pickers. The per-tag visibility narrowing
        for the unified-tags privacy rule is applied at read time by
        :func:`build_tag_visibility_predicate`; the index just acts as
        the denormalized read source for the chip preview.

        ``breakdown_data`` lets a caller that already computed the
        per-domain breakdown thread it through, avoiding a duplicate
        scan of ``tag_assignments`` (background reindex worker).
        """
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
        """Refresh each affected tag's Meilisearch document inline.

        One COUNT, one breakdown / recent scan, and one Meilisearch
        partial write per tag. The cost is bounded -- assign / unassign
        touches at most the manual cap (20) tags in one call -- and
        running inline guarantees the chip preview reflects the new
        state on the next ``resolveUrns`` round-trip.

        Returns a ``{tag_id: usage_count}`` map so callers don't need
        a follow-up ``_get_usage_counts`` for the realtime payload.
        """
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
        """Return ``(per_domain_count, recent_urns, recent_iso_timestamps)``.

        Used by :meth:`_index_tag_entity` to denormalize the chip
        preview's stats row into the tag's Meilisearch document so the
        chip resolves without a per-render database hop.
        """
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
            .limit(_RECENT_ASSIGNMENT_LIMIT)
        )
        recent_rows = (await self.session.execute(recent_stmt)).all()
        recent_urns = [row[0] for row in recent_rows]
        recent_at = [
            row[1].isoformat() if row[1] is not None else "" for row in recent_rows
        ]
        return breakdown, recent_urns, recent_at

    async def _remove_tag_entity(self, tag_urn: str, organization_id: UUID) -> None:
        await self.indexer.remove(tag_urn, organization_id)

    async def list_assigned_urns_for_tag(self, tag_id: UUID) -> list[str]:
        """Return every URN currently assigned the tag (used by reindexers)."""
        result = await self.session.execute(
            select(TagAssignment.content_urn).where(TagAssignment.tag_id == tag_id)
        )
        return [row[0] for row in result.all()]

    async def _get_by_id(self, organization_id: UUID, tag_id: UUID) -> Tag | None:
        result = await self.session.execute(
            select(Tag).where(
                Tag.id == tag_id, Tag.organization_id == organization_id
            )
        )
        return result.scalars().first()

    async def _get_by_slug(self, organization_id: UUID, slug: str) -> Tag | None:
        if not slug:
            return None
        result = await self.session.execute(
            select(Tag).where(
                Tag.organization_id == organization_id, Tag.slug == slug
            )
        )
        return result.scalars().first()

    async def _fetch_tags(
        self, organization_id: UUID, tag_ids: list[UUID]
    ) -> list[Tag]:
        if not tag_ids:
            return []
        result = await self.session.execute(
            select(Tag).where(
                Tag.organization_id == organization_id,
                Tag.id.in_(tag_ids),
            )
        )
        return list(result.scalars().all())

    async def _fetch_assignments(
        self,
        content_urn: str,
        tag_ids: Iterable[UUID] | None,
    ) -> list[TagAssignment]:
        stmt = select(TagAssignment).where(TagAssignment.content_urn == content_urn)
        if tag_ids is not None:
            stmt = stmt.where(TagAssignment.tag_id.in_(list(tag_ids)))
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def _count_manual_for_urn(self, content_urn: str) -> int:
        result = await self.session.execute(
            select(func.count())
            .select_from(TagAssignment)
            .where(
                and_(
                    TagAssignment.content_urn == content_urn,
                    TagAssignment.sources.any(SOURCE_MANUAL),
                )
            )
        )
        return int(result.scalar() or 0)

    async def _get_usage_count(
        self,
        organization_id: UUID,
        tag_id: UUID,
    ) -> int:
        """Read the cached assignment count for a tag.

        Stampede-protected: a cold miss on a hot tag (``todo`` /
        ``urgent`` with tens of thousands of assignments) collapses
        every concurrent caller onto one ``COUNT(*)`` via the locked
        loader, the rest poll the cache key for the lock TTL.
        """
        async def _load() -> dict[str, int]:
            result = await self.session.execute(
                select(func.count())
                .select_from(TagAssignment)
                .where(TagAssignment.tag_id == tag_id)
            )
            return {"count": int(result.scalar() or 0)}

        payload = await cache_get_or_set_locked(
            _count_cache_key(organization_id, tag_id),
            _load,
            ttl=_COUNT_CACHE_TTL,
        )
        if payload is None or "count" not in payload:
            return 0
        return int(payload["count"])

    async def _get_usage_counts(
        self,
        organization_id: UUID,
        tag_ids: list[UUID],
    ) -> dict[UUID, int]:
        if not tag_ids:
            return {}

        keys = [_count_cache_key(organization_id, tid) for tid in tag_ids]
        hits, misses = await cache_get_many(keys)

        counts: dict[UUID, int] = {}
        miss_ids: list[UUID] = []
        miss_id_by_key = dict(zip(keys, tag_ids, strict=True))

        for key, payload in hits.items():
            if isinstance(payload, dict) and "count" in payload:
                counts[miss_id_by_key[key]] = int(payload["count"])
            else:
                miss_ids.append(miss_id_by_key[key])

        for key in misses:
            miss_ids.append(miss_id_by_key[key])

        if miss_ids:
            result = await self.session.execute(
                select(TagAssignment.tag_id, func.count())
                .where(TagAssignment.tag_id.in_(miss_ids))
                .group_by(TagAssignment.tag_id)
            )
            rows = {row[0]: int(row[1]) for row in result.all()}
            for tag_id in miss_ids:
                count = rows.get(tag_id, 0)
                counts[tag_id] = count
                await cache_set(
                    _count_cache_key(organization_id, tag_id),
                    {"count": count},
                    ttl=_COUNT_CACHE_TTL,
                )

        for tag_id in tag_ids:
            counts.setdefault(tag_id, 0)
        return counts

    async def _invalidate_counts(
        self,
        organization_id: UUID,
        tag_ids: Iterable[UUID],
    ) -> None:
        keys = [
            _count_cache_key(organization_id, tag_id)
            for tag_id in dict.fromkeys(tag_ids)
        ]
        if keys:
            await cache_invalidate_many(*keys)


def _format_breakdown(breakdown: dict[str, int]) -> str:
    """Pipe-encode a per-domain usage breakdown for Meili metadata.

    Format: ``NOTE:12|FILE:3|TASK:5``. Empty when the tag has no
    assignments. Pipes / colons match the existing convention used by
    other metadata fields.
    """
    if not breakdown:
        return ""
    return "|".join(
        f"{ct}:{count}"
        for ct, count in sorted(breakdown.items(), key=lambda kv: -kv[1])
    )


def _format_pipes(values: list[str]) -> str:
    """Pipe-encode a parallel-array field. Empty when no entries."""
    return "|".join(values) if values else ""


def _encode_offset(offset: int) -> str:
    return str(offset)


def _decode_offset(token: str | None) -> int:
    if not token:
        return 0
    try:
        value = int(token)
    except ValueError as exc:
        raise ValidationError("page_token", f"invalid page token {token!r}") from exc
    if value < 0:
        raise ValidationError("page_token", "negative offset")
    return value


