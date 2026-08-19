from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest

from uniffy.core.search.meilisearch import SearchCandidateScope
from uniffy.core.types import AccessMode, ContentRole, ContentType, generate_id
from uniffy.domains.permissions.resource_access import (
    ResourceAccessDecision,
    ResourceKey,
    ResourceRowState,
)
from uniffy.domains.search import operations as operations_module
from uniffy.domains.search.operations import SearchOperations
from uniffy.domains.search.queries import SearchResult


def _result(content_id=None) -> SearchResult:
    content_id = content_id or generate_id()
    return SearchResult(
        urn=f"urn:uniffy:content:NOTE:{content_id}",
        organization_id=generate_id(),
        title=f"Note {content_id}",
        description=None,
        entity_type="note",
        url_path=f"/notes/{content_id}",
        access_mode=AccessMode.OWNER_ONLY.value,
        baseline_role=None,
        owner_id=generate_id(),
        tags=None,
        metadata=None,
        updated_at=None,
        rank_score=1.0,
        search_score=1.0,
    )


def _typed_result(content_type: ContentType) -> SearchResult:
    result = _result()
    content_id = result.urn.rsplit(":", 1)[1]
    result.urn = f"urn:uniffy:content:{content_type.value}:{content_id}"
    result.entity_type = content_type.value.lower()
    return result


def _decision(result: SearchResult, can_view: bool) -> ResourceAccessDecision:
    key = ResourceKey(ContentType.NOTE, UUID(result.urn.rsplit(":", 1)[1]))
    return ResourceAccessDecision(
        key=key,
        row_state=ResourceRowState.LIVE,
        can_view=can_view,
        role=ContentRole.VIEWER if can_view else None,
    )


def _operations(*, active_member: bool = True, support: bool = False) -> SearchOperations:
    operations = SearchOperations(MagicMock())
    operations.resource_access = MagicMock()
    operations.resource_access.subject = AsyncMock(
        return_value=SimpleNamespace(
            is_active_member=active_member,
            support_role=ContentRole.VIEWER if support else None,
            group_ids=frozenset(),
        )
    )
    operations.resource_access.resolve = AsyncMock()
    return operations


async def test_search_discards_stale_meili_allows_and_returns_safe_pagination(monkeypatch) -> None:
    organization_id = generate_id()
    allowed_first, denied, allowed_second = _result(), _result(), _result()
    for result in (allowed_first, denied, allowed_second):
        result.organization_id = organization_id
    execute = AsyncMock(return_value=([allowed_first, denied, allowed_second], 3))
    monkeypatch.setattr(operations_module, "execute_search", execute)
    operations = _operations()
    decisions = [
        _decision(allowed_first, True),
        _decision(denied, False),
        _decision(allowed_second, True),
    ]
    operations.resource_access.resolve.return_value = {
        decision.key: decision for decision in decisions
    }

    results, has_more, next_offset = await operations.search(
        user_id=generate_id(),
        organization_id=organization_id,
        query_text="note",
        limit=1,
    )

    assert results == [allowed_first]
    assert has_more is True
    assert next_offset == 1


async def test_support_session_uses_org_candidates_then_postgres_gate(monkeypatch) -> None:
    organization_id = generate_id()
    candidate = _result()
    candidate.organization_id = organization_id
    execute = AsyncMock(return_value=([candidate], 1))
    monkeypatch.setattr(operations_module, "execute_search", execute)
    operations = _operations(active_member=False, support=True)
    decision = _decision(candidate, True)
    operations.resource_access.resolve.return_value = {decision.key: decision}

    results, has_more, _ = await operations.search(
        user_id=generate_id(),
        organization_id=organization_id,
        query_text="note",
        limit=20,
    )

    assert results == [candidate]
    assert has_more is False
    assert execute.await_args.kwargs["candidate_scope"] is SearchCandidateScope.ORGANIZATION


async def test_search_stops_after_three_hundred_denied_candidates(monkeypatch) -> None:
    organization_id = generate_id()

    async def candidate_page(**kwargs):
        rows = [_result() for _ in range(kwargs["limit"])]
        for row in rows:
            row.organization_id = organization_id
        return rows, 1_000

    execute = AsyncMock(side_effect=candidate_page)
    monkeypatch.setattr(operations_module, "execute_search", execute)
    operations = _operations()

    async def deny_all(**kwargs):
        return {
            key: ResourceAccessDecision(key, ResourceRowState.LIVE, False)
            for key in kwargs["keys"]
        }

    operations.resource_access.resolve.side_effect = deny_all

    results, has_more, next_offset = await operations.search(
        user_id=generate_id(),
        organization_id=organization_id,
        query_text="note",
        limit=20,
    )

    assert results == []
    assert has_more is False
    assert next_offset == 0
    assert execute.await_count == 5
    assert sum(call.kwargs["limit"] for call in execute.await_args_list) == 300


async def test_postgres_resolver_failure_exposes_no_candidate(monkeypatch) -> None:
    organization_id = generate_id()
    candidate = _result()
    candidate.organization_id = organization_id
    monkeypatch.setattr(
        operations_module,
        "execute_search",
        AsyncMock(return_value=([candidate], 1)),
    )
    operations = _operations()
    operations.resource_access.resolve.side_effect = RuntimeError("database unavailable")

    with pytest.raises(RuntimeError, match="database unavailable"):
        await operations.search(
            user_id=generate_id(),
            organization_id=organization_id,
            query_text="note",
        )


async def test_type_priority_authorizes_bounded_initial_window(monkeypatch) -> None:
    organization_id = generate_id()
    notes = [_typed_result(ContentType.NOTE) for _ in range(2)]
    files = [_typed_result(ContentType.FILE) for _ in range(2)]
    for result in (*notes, *files):
        result.organization_id = organization_id

    execute = AsyncMock(return_value=([*files, *notes], 4))
    monkeypatch.setattr(operations_module, "execute_search", execute)
    operations = _operations()

    async def allow_all(**kwargs):
        return {
            key: ResourceAccessDecision(
                key,
                ResourceRowState.LIVE,
                True,
                ContentRole.VIEWER,
            )
            for key in kwargs["keys"]
        }

    operations.resource_access.resolve.side_effect = allow_all

    results, has_more, _ = await operations.search(
        user_id=generate_id(),
        organization_id=organization_id,
        query_text="report",
        limit=1,
        type_priority=["note"],
    )

    assert results == [notes[0]]
    assert has_more is True
    assert execute.await_count == 1
    assert execute.await_args.kwargs["limit"] == 60


async def test_type_priority_fetches_only_missing_tier(monkeypatch) -> None:
    organization_id = generate_id()
    notes = [_typed_result(ContentType.NOTE) for _ in range(2)]
    files = [_typed_result(ContentType.FILE) for _ in range(2)]
    for result in (*notes, *files):
        result.organization_id = organization_id

    async def candidates(**kwargs):
        if kwargs["type_filters"] == ["note"]:
            return notes, 2
        return files, 2

    execute = AsyncMock(side_effect=candidates)
    monkeypatch.setattr(operations_module, "execute_search", execute)
    operations = _operations()

    async def allow_all(**kwargs):
        return {
            key: ResourceAccessDecision(
                key,
                ResourceRowState.LIVE,
                True,
                ContentRole.VIEWER,
            )
            for key in kwargs["keys"]
        }

    operations.resource_access.resolve.side_effect = allow_all

    results, has_more, _ = await operations.search(
        user_id=generate_id(),
        organization_id=organization_id,
        query_text="report",
        limit=1,
        type_priority=["note"],
    )

    assert results == [notes[0]]
    assert has_more is True
    assert execute.await_count == 2
    assert execute.await_args_list[1].kwargs["type_filters"] == ["note"]
