"""User-scoped bookmark mutations and authorized listing."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.references import parse_urn
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.bookmarks.bookmark import Bookmark
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType
from uniffy.domains.bookmarks.pagination import (
    BookmarkCursor,
    decode_bookmark_cursor,
    encode_bookmark_cursor,
)
from uniffy.domains.bookmarks.types import BookmarkItem, BookmarkItemsPage
from uniffy.domains.permissions.resource_access import (
    ResourceAccessPurpose,
    ResourceAccessResolver,
    ResourceKey,
    ResourceRowState,
)
from uniffy.domains.search.operations import SearchOperations
from uniffy.domains.search.queries import (
    SearchResult,
    UrnAvailability,
    get_raw_documents_by_urns,
)

logger = logger.bind(component="bookmarks.operations")

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 100
BOOKMARK_SCAN_BATCH_SIZE = 100
BOOKMARK_MIN_SCAN_BATCH = 25
MAX_BOOKMARK_SCAN = 500


class BookmarksOperations:
    """Manage private bookmark preferences for one user and organization."""

    def __init__(
        self,
        session: AsyncSession,
        resource_access: ResourceAccessResolver | None = None,
    ) -> None:
        self.session = session
        self.resource_access = resource_access or ResourceAccessResolver(session)

    async def toggle(
        self,
        user_id: UUID,
        organization_id: UUID,
        urn: str,
    ) -> tuple[bool, Bookmark | None]:
        await self._require_active_member(user_id, organization_id)
        key = _parse_bookmark_urn(urn)
        canonical_urn = build_content_urn(key.content_type, key.content_id)

        existing = await self._get_bookmark(user_id, organization_id, canonical_urn)
        if existing is not None:
            await self.session.delete(existing)
            await self.session.commit()
            return False, None

        decisions = await self.resource_access.resolve(
            actor_id=user_id,
            organization_id=organization_id,
            keys=(key,),
            purpose=ResourceAccessPurpose.REFERENCE,
        )
        decision = decisions[key]
        if decision.row_state is not ResourceRowState.LIVE:
            raise NotFoundError("content", key.content_id)
        if not decision.can_view:
            raise PermissionDeniedError("bookmark", key.content_type.value.lower())

        # Two clients toggling the same URN would otherwise race the unique
        # constraint into an IntegrityError and a 500.
        inserted = (
            await self.session.execute(
                pg_insert(Bookmark)
                .values(
                    user_id=user_id,
                    organization_id=organization_id,
                    urn=canonical_urn,
                    content_type=key.content_type,
                    # A Core insert skips the model's default_factory and the
                    # column carries no server default.
                    created_at=datetime.now(UTC),
                )
                .on_conflict_do_nothing(constraint="uq_bookmarks_user_org_urn")
                .returning(Bookmark.id)
            )
        ).scalar_one_or_none()
        await self.session.commit()

        if inserted is None:
            return True, await self._get_bookmark(user_id, organization_id, canonical_urn)
        return True, await self.session.get(Bookmark, inserted)

    async def list_bookmark_items(
        self,
        user_id: UUID,
        organization_id: UUID,
        *,
        content_types: tuple[ContentType, ...] = (),
        page_size: int = DEFAULT_PAGE_SIZE,
        page_token: str | None = None,
    ) -> BookmarkItemsPage:
        await self._require_active_member(user_id, organization_id)
        page_size = max(1, min(page_size or DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE))
        cursor = decode_bookmark_cursor(page_token) if page_token else None
        items: list[BookmarkItem] = []
        scanned = 0
        exhausted = False
        last_scanned: Bookmark | None = None

        while len(items) <= page_size and scanned < MAX_BOOKMARK_SCAN and not exhausted:
            # The batch never shrinks to the page shortfall: a one-row lookahead
            # would turn a page of revoked bookmarks into hundreds of round trips.
            batch_size = min(
                BOOKMARK_SCAN_BATCH_SIZE,
                MAX_BOOKMARK_SCAN - scanned,
                max(page_size + 1 - len(items), BOOKMARK_MIN_SCAN_BATCH),
            )
            candidates = await self._list_candidate_batch(
                user_id,
                organization_id,
                content_types=content_types,
                cursor=cursor,
                limit=batch_size,
            )
            if not candidates:
                exhausted = True
                break

            scanned += len(candidates)
            last_scanned = candidates[-1]
            cursor = _cursor_for(last_scanned)
            if len(candidates) < batch_size:
                exhausted = True

            resolved_items = await self._resolve_candidates(
                user_id,
                organization_id,
                candidates,
            )
            for item in resolved_items:
                items.append(item)
                if len(items) > page_size:
                    break

        if len(items) > page_size:
            visible_items = items[:page_size]
            next_page_token = encode_bookmark_cursor(_cursor_for(visible_items[-1].bookmark))
        elif not exhausted and last_scanned is not None:
            visible_items = items
            next_page_token = encode_bookmark_cursor(_cursor_for(last_scanned))
        else:
            visible_items = items
            next_page_token = None

        return BookmarkItemsPage(items=visible_items, next_page_token=next_page_token)

    async def is_bookmarked(
        self,
        user_id: UUID,
        organization_id: UUID,
        urn: str,
    ) -> bool:
        await self._require_active_member(user_id, organization_id)
        canonical_urn = _canonical_urn(urn)
        if canonical_urn is None:
            return False
        return await self._get_bookmark(user_id, organization_id, canonical_urn) is not None

    async def bulk_check(
        self,
        user_id: UUID,
        organization_id: UUID,
        urns: list[str],
    ) -> dict[str, bool]:
        await self._require_active_member(user_id, organization_id)
        if not urns:
            return {}
        # Callers may pass any valid spelling of a URN; answer in their spelling
        # while matching on the canonical form actually stored.
        canonical_by_urn = {urn: _canonical_urn(urn) for urn in urns}
        lookup = {canonical for canonical in canonical_by_urn.values() if canonical is not None}
        if not lookup:
            return {urn: False for urn in urns}
        result = await self.session.execute(
            select(Bookmark.urn).where(
                Bookmark.user_id == user_id,
                Bookmark.organization_id == organization_id,
                Bookmark.urn.in_(lookup),
            )
        )
        bookmarked = set(result.scalars().all())
        return {urn: canonical_by_urn[urn] in bookmarked for urn in urns}

    async def _list_candidate_batch(
        self,
        user_id: UUID,
        organization_id: UUID,
        *,
        content_types: tuple[ContentType, ...],
        cursor: BookmarkCursor | None,
        limit: int,
    ) -> list[Bookmark]:
        query = select(Bookmark).where(
            Bookmark.user_id == user_id,
            Bookmark.organization_id == organization_id,
        )
        if content_types:
            query = query.where(Bookmark.content_type.in_(content_types))
        if cursor is not None:
            query = query.where(
                or_(
                    Bookmark.created_at < cursor.created_at,
                    and_(
                        Bookmark.created_at == cursor.created_at,
                        Bookmark.id < cursor.bookmark_id,
                    ),
                )
            )
        result = await self.session.execute(
            query.order_by(Bookmark.created_at.desc(), Bookmark.id.desc()).limit(limit)
        )
        return list(result.scalars().all())

    async def _resolve_candidates(
        self,
        user_id: UUID,
        organization_id: UUID,
        candidates: list[Bookmark],
    ) -> list[BookmarkItem]:
        keys_by_urn = {
            bookmark.urn: ResourceKey(*parsed)
            for bookmark in candidates
            if (parsed := parse_urn(bookmark.urn)) is not None
        }
        decisions = await self.resource_access.resolve(
            actor_id=user_id,
            organization_id=organization_id,
            keys=keys_by_urn.values(),
            purpose=ResourceAccessPurpose.LIST,
        )
        available_urns = [
            urn
            for urn, key in keys_by_urn.items()
            if decisions[key].row_state is ResourceRowState.LIVE and decisions[key].can_view
        ]
        documents: dict[str, SearchResult] = {}
        failed_urns: frozenset[str] = frozenset()
        if available_urns:
            try:
                lookup = await get_raw_documents_by_urns(available_urns, organization_id)
                documents = lookup.documents
                failed_urns = lookup.failed_urns
            except Exception:
                logger.opt(exception=True).warning("Bookmark preview lookup failed")
                failed_urns = frozenset(available_urns)

        items: list[BookmarkItem] = []
        live_documents: dict[str, SearchResult] = {}
        for bookmark in candidates:
            key = keys_by_urn.get(bookmark.urn)
            if key is None:
                items.append(
                    BookmarkItem(
                        bookmark=bookmark,
                        content=_tombstone(bookmark.urn, organization_id),
                    )
                )
                continue
            decision = decisions[key]
            if decision.row_state is ResourceRowState.LIVE and not decision.can_view:
                continue
            if decision.row_state in {ResourceRowState.DELETED, ResourceRowState.MISSING}:
                content = _tombstone(
                    bookmark.urn,
                    organization_id,
                    UrnAvailability.DELETED,
                )
            elif bookmark.urn in failed_urns or bookmark.urn not in documents:
                content = _tombstone(bookmark.urn, organization_id)
            else:
                content = documents[bookmark.urn]
                content.availability = UrnAvailability.AVAILABLE
                live_documents[bookmark.urn] = content
            items.append(BookmarkItem(bookmark=bookmark, content=content))

        # Index documents lag PostgreSQL, so previews would otherwise show a
        # different status here than the same mention renders elsewhere.
        if live_documents:
            await SearchOperations(self.session).enrich_live_state(
                live_documents,
                organization_id,
                user_id,
            )
        return items

    async def _get_bookmark(
        self,
        user_id: UUID,
        organization_id: UUID,
        urn: str,
    ) -> Bookmark | None:
        result = await self.session.execute(
            select(Bookmark).where(
                Bookmark.user_id == user_id,
                Bookmark.organization_id == organization_id,
                Bookmark.urn == urn,
            )
        )
        return result.scalars().first()

    async def _require_active_member(self, user_id: UUID, organization_id: UUID) -> None:
        subject = await self.resource_access.subject(
            actor_id=user_id,
            organization_id=organization_id,
        )
        if not subject.is_active_member:
            raise PermissionDeniedError("access", "organization")


def _parse_bookmark_urn(urn: str) -> ResourceKey:
    parsed = parse_urn(urn)
    if parsed is None:
        raise ValidationError("urn", "A valid content URN is required")
    return ResourceKey(*parsed)


def _canonical_urn(urn: str) -> str | None:
    parsed = parse_urn(urn)
    return None if parsed is None else build_content_urn(parsed[0], parsed[1])


def _cursor_for(bookmark: Bookmark) -> BookmarkCursor:
    return BookmarkCursor(created_at=bookmark.created_at, bookmark_id=bookmark.id)


def _tombstone(
    urn: str,
    organization_id: UUID,
    availability: UrnAvailability = UrnAvailability.UNAVAILABLE,
) -> SearchResult:
    parsed = parse_urn(urn)
    return SearchResult(
        urn=urn,
        organization_id=organization_id,
        title="",
        description=None,
        entity_type=parsed[0].value.lower() if parsed is not None else "",
        url_path="",
        access_mode="",
        baseline_role=None,
        owner_id=organization_id,
        tags=None,
        metadata=None,
        updated_at=None,
        rank_score=0.0,
        search_score=None,
        availability=availability,
    )
