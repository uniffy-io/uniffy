"""Read and hydration operations for tags and assignments."""

from collections.abc import Iterable
from enum import StrEnum
from uuid import UUID

from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.cache.operations import cache_get_many, cache_get_or_set_locked, cache_set
from uniffy.core.content.references import parse_urn
from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.tags.tag import Tag, TagAssignment
from uniffy.core.types import ContentType
from uniffy.domains.permissions.access import (
    ResourceAccessPurpose,
    ResourceAccessResolver,
    ResourceKey,
)
from uniffy.domains.tags.normalize import slugify_tag
from uniffy.domains.tags.visibility import (
    build_assignment_visibility_predicate,
    build_tag_visibility_predicate,
)

SOURCE_MANUAL = "manual"
SOURCE_INLINE = "inline"
VALID_SOURCES = frozenset({SOURCE_MANUAL, SOURCE_INLINE})
MAX_MANUAL_TAGS_PER_CONTENT = 20

COUNT_CACHE_TTL = 60
COUNT_CACHE_PREFIX = "tag_count"
COUNT_CACHE_FIELD = "count"

DEFAULT_PAGE_SIZE = 100
MAX_PAGE_SIZE = 500
DEFAULT_SUGGEST_LIMIT = 10
MAX_SUGGEST_LIMIT = 50
RECENT_ASSIGNMENT_LIMIT = 5


class TagSort(StrEnum):
    ALPHA_ASC = "alpha_asc"
    ALPHA_DESC = "alpha_desc"
    RECENT_DESC = "recent_desc"


def count_cache_key(organization_id: UUID, tag_id: UUID) -> str:
    return f"{COUNT_CACHE_PREFIX}:{organization_id}:{tag_id}"


def encode_offset(offset: int) -> str:
    return str(offset)


def decode_offset(token: str | None) -> int:
    if not token:
        return 0
    try:
        value = int(token)
    except ValueError as exc:
        raise ValidationError("page_token", f"invalid page token {token!r}") from exc
    if value < 0:
        raise ValidationError("page_token", "negative offset")
    return value


class TagReader:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def filter_viewable_urns(
        self,
        *,
        actor_id: UUID,
        organization_id: UUID,
        content_urns: Iterable[str],
    ) -> list[str]:
        parsed = {
            urn: ResourceKey(*key)
            for urn in dict.fromkeys(content_urns)
            if (key := parse_urn(urn)) is not None
        }
        if not parsed:
            return []
        try:
            decisions = await ResourceAccessResolver(self.session).resolve(
                actor_id=actor_id,
                organization_id=organization_id,
                keys=parsed.values(),
                purpose=ResourceAccessPurpose.REFERENCE,
            )
        except ValueError as exc:
            raise ValidationError("content_urns", str(exc)) from exc
        return [urn for urn, key in parsed.items() if decisions[key].can_view]

    async def get(
        self,
        *,
        organization_id: UUID,
        tag_or_slug: str,
        actor_id: UUID | None = None,
    ) -> Tag:
        """Hidden tags raise ``NotFoundError`` (404 instead of 403) to
        prevent id/slug enumeration.
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
        sort: TagSort = TagSort.RECENT_DESC,
        page_size: int = DEFAULT_PAGE_SIZE,
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
        page_size = max(1, min(page_size, MAX_PAGE_SIZE))
        offset = decode_offset(page_token)

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
            stmt = stmt.where(or_(func.lower(Tag.name).like(needle), Tag.slug.like(needle)))

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

        if sort == TagSort.ALPHA_ASC:
            stmt = stmt.order_by(Tag.name.asc(), Tag.id.asc())
        elif sort == TagSort.ALPHA_DESC:
            stmt = stmt.order_by(Tag.name.desc(), Tag.id.desc())
        elif sort == TagSort.RECENT_DESC:
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

        next_token = encode_offset(offset + page_size) if has_more else None
        return tags, counts, next_token

    async def suggest(
        self,
        *,
        organization_id: UUID,
        prefix: str,
        limit: int = DEFAULT_SUGGEST_LIMIT,
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
        limit = max(1, min(limit, MAX_SUGGEST_LIMIT))

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
        page_size: int = DEFAULT_PAGE_SIZE,
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
        page_size = max(1, min(page_size, MAX_PAGE_SIZE))
        offset = decode_offset(page_token)

        stmt = select(TagAssignment).where(TagAssignment.tag_id == tag.id)
        if content_types:
            stmt = stmt.where(TagAssignment.content_type.in_([ct.value for ct in content_types]))
        if sources:
            valid = [s for s in sources if s in VALID_SOURCES]
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

        next_token = encode_offset(offset + page_size) if has_more else None
        return assignments, next_token

    async def list_assigned_urns_for_tag(self, tag_id: UUID) -> list[str]:
        """Return every URN currently assigned the tag (used by reindexers)."""
        result = await self.session.execute(
            select(TagAssignment.content_urn).where(TagAssignment.tag_id == tag_id)
        )
        return [row[0] for row in result.all()]

    async def _get_by_id(self, organization_id: UUID, tag_id: UUID) -> Tag | None:
        result = await self.session.execute(
            select(Tag).where(Tag.id == tag_id, Tag.organization_id == organization_id)
        )
        return result.scalars().first()

    async def _get_by_slug(self, organization_id: UUID, slug: str) -> Tag | None:
        if not slug:
            return None
        result = await self.session.execute(
            select(Tag).where(Tag.organization_id == organization_id, Tag.slug == slug)
        )
        return result.scalars().first()

    async def _fetch_tags(self, organization_id: UUID, tag_ids: list[UUID]) -> list[Tag]:
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
                select(func.count()).select_from(TagAssignment).where(TagAssignment.tag_id == tag_id)
            )
            return {COUNT_CACHE_FIELD: int(result.scalar() or 0)}

        payload = await cache_get_or_set_locked(
            count_cache_key(organization_id, tag_id),
            _load,
            ttl=COUNT_CACHE_TTL,
        )
        if payload is None or COUNT_CACHE_FIELD not in payload:
            return 0
        return int(payload[COUNT_CACHE_FIELD])

    async def _get_usage_counts(
        self,
        organization_id: UUID,
        tag_ids: list[UUID],
    ) -> dict[UUID, int]:
        if not tag_ids:
            return {}

        keys = [count_cache_key(organization_id, tid) for tid in tag_ids]
        hits, misses = await cache_get_many(keys)

        counts: dict[UUID, int] = {}
        miss_ids: list[UUID] = []
        miss_id_by_key = dict(zip(keys, tag_ids, strict=True))

        for key, payload in hits.items():
            if isinstance(payload, dict) and COUNT_CACHE_FIELD in payload:
                counts[miss_id_by_key[key]] = int(payload[COUNT_CACHE_FIELD])
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
                    count_cache_key(organization_id, tag_id),
                    {COUNT_CACHE_FIELD: count},
                    ttl=COUNT_CACHE_TTL,
                )

        for tag_id in tag_ids:
            counts.setdefault(tag_id, 0)
        return counts
