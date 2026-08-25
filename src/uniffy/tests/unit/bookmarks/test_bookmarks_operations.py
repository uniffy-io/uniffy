from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.bookmarks.bookmark import Bookmark
from uniffy.core.types import AccessMode, ContentType, generate_id
from uniffy.domains.bookmarks.operations import (
    BOOKMARK_MIN_SCAN_BATCH,
    BOOKMARK_SCAN_BATCH_SIZE,
    MAX_BOOKMARK_SCAN,
    BookmarksOperations,
)
from uniffy.domains.bookmarks.pagination import decode_bookmark_cursor
from uniffy.domains.bookmarks.types import BookmarkItem
from uniffy.domains.permissions.resource_access import (
    ResourceAccessDecision,
    ResourceAccessResolver,
    ResourceKey,
    ResourceRowState,
)
from uniffy.domains.search.operations import SearchOperations
from uniffy.domains.search.queries import SearchResult, UrnAvailability, UrnLookupResult

USER_ID = generate_id()
ORG_ID = generate_id()
NOW = datetime.now(UTC)


def _session() -> MagicMock:
    session = MagicMock()
    session.delete = AsyncMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    return session


def _bookmark(index: int, content_type: ContentType = ContentType.NOTE) -> Bookmark:
    content_id = generate_id()
    return Bookmark(
        id=generate_id(),
        user_id=USER_ID,
        organization_id=ORG_ID,
        urn=f"urn:uniffy:content:{content_type.value}:{content_id}",
        content_type=content_type,
        created_at=NOW - timedelta(seconds=index),
    )


def _preview(bookmark: Bookmark, availability: UrnAvailability) -> SearchResult:
    content_type = ContentType(bookmark.urn.split(":")[3])
    return SearchResult(
        urn=bookmark.urn,
        organization_id=ORG_ID,
        title="Saved item",
        description="Preview",
        entity_type=content_type.value.lower(),
        url_path="/saved/item",
        access_mode=AccessMode.OWNER_ONLY.value,
        baseline_role=None,
        owner_id=USER_ID,
        tags=None,
        metadata=None,
        updated_at=NOW,
        rank_score=1.0,
        search_score=None,
        availability=availability,
    )


def _ops(
    *,
    session: MagicMock | None = None,
    access: ResourceAccessResolver | None = None,
) -> BookmarksOperations:
    if access is None:
        access = MagicMock(spec=ResourceAccessResolver)
        access.subject = AsyncMock(return_value=SimpleNamespace(is_active_member=True))
    return BookmarksOperations(
        session or _session(),
        resource_access=access,
    )


async def test_toggle_adds_a_live_viewable_resource() -> None:
    session = _session()
    content_id = generate_id()
    urn = f"urn:uniffy:content:NOTE:{content_id}"
    key = ResourceKey(ContentType.NOTE, content_id)
    stored = Bookmark(
        id=generate_id(),
        user_id=USER_ID,
        organization_id=ORG_ID,
        urn=urn,
        content_type=ContentType.NOTE,
    )
    access = MagicMock(spec=ResourceAccessResolver)
    access.subject = AsyncMock(return_value=SimpleNamespace(is_active_member=True))
    access.resolve = AsyncMock(
        return_value={
            key: ResourceAccessDecision(
                key=key,
                row_state=ResourceRowState.LIVE,
                can_view=True,
            )
        }
    )
    session.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=lambda: stored.id),
    )
    session.get = AsyncMock(return_value=stored)
    ops = _ops(session=session, access=access)
    ops._get_bookmark = AsyncMock(return_value=None)

    is_bookmarked, bookmark = await ops.toggle(USER_ID, ORG_ID, urn)

    assert is_bookmarked is True
    assert bookmark is stored
    session.commit.assert_awaited_once()
    access.resolve.assert_awaited_once()


async def test_concurrent_toggle_reports_the_winning_row_instead_of_raising() -> None:
    session = _session()
    content_id = generate_id()
    urn = f"urn:uniffy:content:NOTE:{content_id}"
    key = ResourceKey(ContentType.NOTE, content_id)
    winner = Bookmark(
        id=generate_id(),
        user_id=USER_ID,
        organization_id=ORG_ID,
        urn=urn,
        content_type=ContentType.NOTE,
    )
    access = MagicMock(spec=ResourceAccessResolver)
    access.subject = AsyncMock(return_value=SimpleNamespace(is_active_member=True))
    access.resolve = AsyncMock(
        return_value={
            key: ResourceAccessDecision(key=key, row_state=ResourceRowState.LIVE, can_view=True)
        }
    )
    # ON CONFLICT DO NOTHING swallowed the insert because the other client won.
    session.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: None))
    ops = _ops(session=session, access=access)
    ops._get_bookmark = AsyncMock(side_effect=[None, winner])

    is_bookmarked, bookmark = await ops.toggle(USER_ID, ORG_ID, urn)

    assert is_bookmarked is True
    assert bookmark is winner


@pytest.mark.parametrize(
    "alias",
    [
        "urn:uniffy:content:NOTE:0189f3a111117abc8def0123456789ab",
        "urn:uniffy:content:NOTE:0189F3A1-1111-7ABC-8DEF-0123456789AB",
        "urn:uniffy:content:NOTE:{0189f3a1-1111-7abc-8def-0123456789ab}",
        "urn:uniffy:content:NOTE:urn:uuid:0189f3a1-1111-7abc-8def-0123456789ab",
    ],
)
async def test_urn_aliases_resolve_to_the_stored_canonical_bookmark(alias: str) -> None:
    """UUID spellings must not slip past uq_bookmarks_user_org_urn as separate rows."""
    canonical = "urn:uniffy:content:NOTE:0189f3a1-1111-7abc-8def-0123456789ab"
    existing = Bookmark(
        id=generate_id(),
        user_id=USER_ID,
        organization_id=ORG_ID,
        urn=canonical,
        content_type=ContentType.NOTE,
    )
    session = _session()
    access = MagicMock(spec=ResourceAccessResolver)
    access.subject = AsyncMock(return_value=SimpleNamespace(is_active_member=True))
    access.resolve = AsyncMock()
    ops = _ops(session=session, access=access)
    ops._get_bookmark = AsyncMock(return_value=existing)

    is_bookmarked, bookmark = await ops.toggle(USER_ID, ORG_ID, alias)

    assert (is_bookmarked, bookmark) == (False, None)
    assert ops._get_bookmark.await_args.args[2] == canonical
    session.delete.assert_awaited_once_with(existing)
    access.resolve.assert_not_awaited()


async def test_toggle_removes_an_existing_bookmark_without_rechecking_access() -> None:
    session = _session()
    bookmark = _bookmark(0)
    access = MagicMock(spec=ResourceAccessResolver)
    access.subject = AsyncMock(return_value=SimpleNamespace(is_active_member=True))
    access.resolve = AsyncMock()
    ops = _ops(session=session, access=access)
    ops._get_bookmark = AsyncMock(return_value=bookmark)

    result = await ops.toggle(USER_ID, ORG_ID, bookmark.urn)

    assert result == (False, None)
    session.delete.assert_awaited_once_with(bookmark)
    access.resolve.assert_not_awaited()


async def test_toggle_rejects_invalid_missing_and_denied_resources() -> None:
    access = MagicMock(spec=ResourceAccessResolver)
    access.subject = AsyncMock(return_value=SimpleNamespace(is_active_member=True))
    access.resolve = AsyncMock()
    ops = _ops(access=access)
    ops._get_bookmark = AsyncMock(return_value=None)

    with pytest.raises(ValidationError):
        await ops.toggle(USER_ID, ORG_ID, "not-a-urn")
    access.resolve.assert_not_awaited()

    content_id = generate_id()
    urn = f"urn:uniffy:content:NOTE:{content_id}"
    key = ResourceKey(ContentType.NOTE, content_id)
    access.resolve.return_value = {
        key: ResourceAccessDecision(
            key=key,
            row_state=ResourceRowState.MISSING,
            can_view=False,
        )
    }
    with pytest.raises(NotFoundError):
        await ops.toggle(USER_ID, ORG_ID, urn)

    access.resolve.return_value = {
        key: ResourceAccessDecision(
            key=key,
            row_state=ResourceRowState.LIVE,
            can_view=False,
        )
    }
    with pytest.raises(PermissionDeniedError):
        await ops.toggle(USER_ID, ORG_ID, urn)


async def test_inactive_org_member_cannot_read_or_mutate_bookmarks() -> None:
    access = MagicMock(spec=ResourceAccessResolver)
    access.subject = AsyncMock(return_value=SimpleNamespace(is_active_member=False))
    access.resolve = AsyncMock()
    ops = _ops(access=access)
    ops._get_bookmark = AsyncMock(return_value=_bookmark(0))

    with pytest.raises(PermissionDeniedError):
        await ops.toggle(USER_ID, ORG_ID, _bookmark(1).urn)
    with pytest.raises(PermissionDeniedError):
        await ops.list_bookmark_items(USER_ID, ORG_ID)
    with pytest.raises(PermissionDeniedError):
        await ops.bulk_check(USER_ID, ORG_ID, [_bookmark(2).urn])

    access.resolve.assert_not_awaited()


async def test_resolved_page_omits_restricted_and_keeps_safe_tombstones() -> None:
    available = _bookmark(0)
    restricted = _bookmark(1, ContentType.FILE)
    deleted = _bookmark(2, ContentType.CHAT_MESSAGE)
    unresolved = _bookmark(3, ContentType.TASK)
    ops = _ops()
    ops._list_candidate_batch = AsyncMock(return_value=[available, restricted, deleted, unresolved])
    ops._resolve_candidates = AsyncMock(
        return_value=[
            BookmarkItem(available, _preview(available, UrnAvailability.AVAILABLE)),
            BookmarkItem(deleted, _preview(deleted, UrnAvailability.DELETED)),
            BookmarkItem(unresolved, None),
        ]
    )

    page = await ops.list_bookmark_items(USER_ID, ORG_ID, page_size=10)

    assert [item.bookmark for item in page.items] == [available, deleted, unresolved]
    assert page.items[-1] == BookmarkItem(bookmark=unresolved, content=None)
    assert page.next_page_token is None


async def test_resolved_page_cursor_uses_the_last_visible_item() -> None:
    first = _bookmark(0)
    second = _bookmark(1)
    ops = _ops()
    ops._list_candidate_batch = AsyncMock(return_value=[first, second])
    ops._resolve_candidates = AsyncMock(
        return_value=[
            BookmarkItem(first, _preview(first, UrnAvailability.AVAILABLE)),
            BookmarkItem(second, _preview(second, UrnAvailability.DELETED)),
        ]
    )

    page = await ops.list_bookmark_items(USER_ID, ORG_ID, page_size=1)

    assert [item.bookmark for item in page.items] == [first]
    assert page.next_page_token is not None
    cursor = decode_bookmark_cursor(page.next_page_token)
    assert cursor.created_at == first.created_at
    assert cursor.bookmark_id == first.id


@pytest.mark.parametrize(
    ("page_size", "expected_limit"),
    [(6, BOOKMARK_MIN_SCAN_BATCH), (50, 51), (100, BOOKMARK_SCAN_BATCH_SIZE)],
)
async def test_candidate_batch_never_drops_below_the_scan_floor(
    page_size: int,
    expected_limit: int,
) -> None:
    ops = _ops()
    ops._list_candidate_batch = AsyncMock(return_value=[])

    await ops.list_bookmark_items(USER_ID, ORG_ID, page_size=page_size)

    assert ops._list_candidate_batch.await_args.kwargs["limit"] == expected_limit


async def test_restricted_rows_keep_the_batch_at_the_scan_floor() -> None:
    """A one-row lookahead would turn a revoked page into hundreds of round trips."""
    first_batch = [_bookmark(index) for index in range(BOOKMARK_MIN_SCAN_BATCH)]
    second_batch = [_bookmark(index + BOOKMARK_MIN_SCAN_BATCH) for index in range(2)]
    visible_first_batch = [
        BookmarkItem(bookmark, _preview(bookmark, UrnAvailability.AVAILABLE))
        for bookmark in first_batch[:5]
    ]
    visible_second_batch = [
        BookmarkItem(bookmark, _preview(bookmark, UrnAvailability.AVAILABLE))
        for bookmark in second_batch
    ]
    ops = _ops()
    ops._list_candidate_batch = AsyncMock(side_effect=[first_batch, second_batch])
    ops._resolve_candidates = AsyncMock(side_effect=[visible_first_batch, visible_second_batch])

    page = await ops.list_bookmark_items(USER_ID, ORG_ID, page_size=6)

    assert len(page.items) == 6
    assert [call.kwargs["limit"] for call in ops._list_candidate_batch.await_args_list] == [
        BOOKMARK_MIN_SCAN_BATCH,
        BOOKMARK_MIN_SCAN_BATCH,
    ]


async def test_restricted_scan_is_bounded_and_returns_continuation() -> None:
    next_index = 0

    async def restricted_batch(*_args: object, limit: int, **_kwargs: object) -> list[Bookmark]:
        nonlocal next_index
        batch = [_bookmark(next_index + index) for index in range(limit)]
        next_index += limit
        return batch

    ops = _ops()
    ops._list_candidate_batch = AsyncMock(side_effect=restricted_batch)
    ops._resolve_candidates = AsyncMock(return_value=[])

    page = await ops.list_bookmark_items(USER_ID, ORG_ID)

    assert page.items == []
    assert page.next_page_token is not None
    assert next_index == MAX_BOOKMARK_SCAN
    assert ops._list_candidate_batch.await_count == 10
    assert ops._resolve_candidates.await_count == 10


async def test_filling_a_page_never_degrades_into_single_row_queries() -> None:
    """The tail after a full page must not be probed one row at a time."""
    viewable = [_bookmark(index) for index in range(50)]
    next_index = 50

    async def batch(*_args: object, limit: int, **_kwargs: object) -> list[Bookmark]:
        nonlocal next_index
        rows = [_bookmark(next_index + offset) for offset in range(limit)]
        next_index += limit
        return rows

    resolved = iter([
        [BookmarkItem(b, _preview(b, UrnAvailability.AVAILABLE)) for b in viewable],
    ])
    ops = _ops()
    ops._list_candidate_batch = AsyncMock(side_effect=batch)
    ops._resolve_candidates = AsyncMock(side_effect=lambda *_a: next(resolved, []))

    page = await ops.list_bookmark_items(USER_ID, ORG_ID, page_size=50)

    assert len(page.items) == 50
    assert page.next_page_token is not None
    # The old shortfall-sized lookahead issued ~450 LIMIT 1 queries here.
    assert ops._list_candidate_batch.await_count <= 20


async def test_candidate_resolution_authorizes_before_preview_lookup() -> None:
    available = _bookmark(0)
    restricted = _bookmark(1)
    deleted = _bookmark(2)
    keys = {
        bookmark.urn: ResourceKey(*_parse_urn_parts(bookmark.urn))
        for bookmark in (available, restricted, deleted)
    }
    access = MagicMock(spec=ResourceAccessResolver)
    access.subject = AsyncMock(return_value=SimpleNamespace(is_active_member=True))
    access.resolve = AsyncMock(
        return_value={
            keys[available.urn]: ResourceAccessDecision(
                keys[available.urn], ResourceRowState.LIVE, True
            ),
            keys[restricted.urn]: ResourceAccessDecision(
                keys[restricted.urn], ResourceRowState.LIVE, False
            ),
            keys[deleted.urn]: ResourceAccessDecision(
                keys[deleted.urn], ResourceRowState.DELETED, False
            ),
        }
    )
    ops = _ops(access=access)
    lookup = UrnLookupResult(
        documents={available.urn: _preview(available, UrnAvailability.AVAILABLE)},
        failed_urns=frozenset(),
    )

    with (
        patch(
            "uniffy.domains.bookmarks.operations.get_raw_documents_by_urns",
            new=AsyncMock(return_value=lookup),
        ) as preview_lookup,
        patch.object(SearchOperations, "enrich_live_state", new=AsyncMock()) as enrich,
    ):
        items = await ops._resolve_candidates(USER_ID, ORG_ID, [available, restricted, deleted])

    assert [item.bookmark for item in items] == [available, deleted]
    assert items[1].content is not None
    assert items[1].content.availability is UrnAvailability.DELETED
    preview_lookup.assert_awaited_once_with([available.urn], ORG_ID)
    # Previews must carry the same PostgreSQL live state the mention path applies.
    enrich.assert_awaited_once()
    assert list(enrich.await_args.args[0]) == [available.urn]


async def test_missing_rows_render_a_final_tombstone_not_a_retry_state() -> None:
    missing = _bookmark(0)
    key = ResourceKey(*_parse_urn_parts(missing.urn))
    access = MagicMock(spec=ResourceAccessResolver)
    access.subject = AsyncMock(return_value=SimpleNamespace(is_active_member=True))
    access.resolve = AsyncMock(
        return_value={key: ResourceAccessDecision(key, ResourceRowState.MISSING, False)}
    )
    ops = _ops(access=access)

    items = await ops._resolve_candidates(USER_ID, ORG_ID, [missing])

    assert len(items) == 1
    assert items[0].content is not None
    assert items[0].content.availability is UrnAvailability.DELETED


async def test_preview_outage_does_not_restore_restricted_rows() -> None:
    available = _bookmark(0)
    restricted = _bookmark(1)
    keys = {
        bookmark.urn: ResourceKey(*_parse_urn_parts(bookmark.urn))
        for bookmark in (available, restricted)
    }
    access = MagicMock(spec=ResourceAccessResolver)
    access.subject = AsyncMock(return_value=SimpleNamespace(is_active_member=True))
    access.resolve = AsyncMock(
        return_value={
            keys[available.urn]: ResourceAccessDecision(
                keys[available.urn], ResourceRowState.LIVE, True
            ),
            keys[restricted.urn]: ResourceAccessDecision(
                keys[restricted.urn], ResourceRowState.LIVE, False
            ),
        }
    )
    ops = _ops(access=access)

    with patch(
        "uniffy.domains.bookmarks.operations.get_raw_documents_by_urns",
        new=AsyncMock(side_effect=RuntimeError("unavailable")),
    ):
        items = await ops._resolve_candidates(USER_ID, ORG_ID, [available, restricted])

    assert [item.bookmark for item in items] == [available]
    assert items[0].content is not None
    assert items[0].content.availability is UrnAvailability.UNAVAILABLE


async def test_content_type_filters_reach_the_candidate_query() -> None:
    ops = _ops()
    ops._list_candidate_batch = AsyncMock(return_value=[])

    page = await ops.list_bookmark_items(
        USER_ID,
        ORG_ID,
        content_types=(ContentType.NOTE, ContentType.CHAT_MESSAGE),
    )

    assert page.items == []
    assert ops._list_candidate_batch.await_args.kwargs["content_types"] == (
        ContentType.NOTE,
        ContentType.CHAT_MESSAGE,
    )


def test_malformed_cursor_is_rejected() -> None:
    with pytest.raises(ValidationError):
        decode_bookmark_cursor("definitely-not-a-cursor")


async def test_bulk_check_answers_in_the_callers_spelling() -> None:
    canonical = "urn:uniffy:content:NOTE:0189f3a1-1111-7abc-8def-0123456789ab"
    alias = "urn:uniffy:content:NOTE:0189F3A1-1111-7ABC-8DEF-0123456789AB"
    session = _session()
    session.execute = AsyncMock(
        return_value=MagicMock(scalars=lambda: MagicMock(all=lambda: [canonical]))
    )
    ops = _ops(session=session)

    result = await ops.bulk_check(USER_ID, ORG_ID, [alias, "not-a-urn"])

    assert result == {alias: True, "not-a-urn": False}


def _parse_urn_parts(urn: str) -> tuple[ContentType, UUID]:
    parts = urn.split(":")
    return ContentType(parts[3]), UUID(parts[4])
