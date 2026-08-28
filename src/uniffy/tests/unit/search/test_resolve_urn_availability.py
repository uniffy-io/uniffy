from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
from uniffy_proto.search.v1.search_pb2 import UrnAvailability as ProtoUrnAvailability

from uniffy.core.types import AccessMode, ContentRole, ContentType, generate_id
from uniffy.domains.permissions.access import (
    AccessGrantKind,
    RequestTarget,
    ResourceAccessDecision,
    ResourceKey,
    ResourceRowState,
)
from uniffy.domains.search import operations as operations_module
from uniffy.domains.search.converters import search_result_to_urn_metadata
from uniffy.domains.search.operations import SearchOperations
from uniffy.domains.search.queries import SearchResult, UrnAvailability, UrnLookupResult


def _urn(content_type: ContentType) -> str:
    return f"urn:uniffy:content:{content_type.value}:{generate_id()}"


def _key(urn: str) -> ResourceKey:
    parts = urn.split(":")
    return ResourceKey(ContentType(parts[3]), UUID(parts[4]))


def _document(urn: str, organization_id, *, title: str = "Private title") -> SearchResult:
    return SearchResult(
        urn=urn,
        organization_id=organization_id,
        title=title,
        description="Private description",
        entity_type=urn.split(":")[3].lower(),
        url_path="/private/path",
        access_mode=AccessMode.OWNER_ONLY.value,
        baseline_role=None,
        owner_id=generate_id(),
        tags=["secret"],
        metadata={"secret": "value"},
        updated_at=None,
        rank_score=1.0,
        search_score=None,
    )


def _decision(
    urn: str,
    *,
    state: ResourceRowState = ResourceRowState.LIVE,
    can_view: bool = False,
    requestable: bool = False,
) -> ResourceAccessDecision:
    key = _key(urn)
    return ResourceAccessDecision(
        key=key,
        row_state=state,
        can_view=can_view,
        role=ContentRole.VIEWER if can_view else None,
        request_target=(
            RequestTarget(key.content_type, key.content_id, AccessGrantKind.STANDARD)
            if requestable
            else None
        ),
    )


@pytest.fixture
def resolver() -> SearchOperations:
    operations = SearchOperations(MagicMock())
    operations.resource_access = MagicMock()
    operations.resource_access.resolve = AsyncMock()
    operations.enrich_live_state = AsyncMock()
    return operations


async def test_resolve_composes_postgres_decisions_with_raw_previews(
    monkeypatch,
    resolver: SearchOperations,
) -> None:
    organization_id = generate_id()
    available_urn = _urn(ContentType.NOTE)
    restricted_urn = _urn(ContentType.NOTE)
    deleted_urn = _urn(ContentType.FILE)
    missing_urn = _urn(ContentType.PROJECT)
    live_unindexed_urn = _urn(ContentType.TASK)
    raw_failure_urn = _urn(ContentType.CHAT)
    unresolved_urn = _urn(ContentType.ROOM)
    invalid_urn = "not-a-urn"

    raw = AsyncMock(
        return_value=UrnLookupResult(
            documents={
                available_urn: _document(available_urn, organization_id, title="Visible"),
                restricted_urn: _document(restricted_urn, organization_id),
                deleted_urn: _document(deleted_urn, organization_id),
                missing_urn: _document(missing_urn, organization_id),
            },
            failed_urns=frozenset({raw_failure_urn}),
        )
    )
    monkeypatch.setattr(operations_module, "get_raw_documents_by_urns", raw)

    decisions = [
        _decision(available_urn, can_view=True),
        _decision(restricted_urn, requestable=True),
        _decision(deleted_urn, state=ResourceRowState.DELETED),
        _decision(missing_urn, state=ResourceRowState.MISSING),
        _decision(live_unindexed_urn, can_view=True),
        _decision(raw_failure_urn, can_view=True),
    ]
    resolver.resource_access.resolve.return_value = {decision.key: decision for decision in decisions}

    result = await resolver.resolve_urns(
        generate_id(),
        organization_id,
        [
            available_urn,
            restricted_urn,
            deleted_urn,
            missing_urn,
            live_unindexed_urn,
            raw_failure_urn,
            unresolved_urn,
            invalid_urn,
        ],
    )

    assert result[available_urn].availability == UrnAvailability.AVAILABLE
    assert result[restricted_urn].availability == UrnAvailability.RESTRICTED
    assert result[restricted_urn].can_request_access is True
    assert result[deleted_urn].availability == UrnAvailability.DELETED
    assert result[missing_urn].availability == UrnAvailability.DELETED
    assert result[live_unindexed_urn].availability == UrnAvailability.UNAVAILABLE
    assert result[raw_failure_urn].availability == UrnAvailability.UNAVAILABLE
    assert result[unresolved_urn].availability == UrnAvailability.UNAVAILABLE
    assert invalid_urn not in result

    restricted = result[restricted_urn]
    assert restricted.title == ""
    assert restricted.description is None
    assert restricted.url_path == ""
    assert restricted.metadata is None
    assert restricted.tags is None
    assert restricted.owner_id == organization_id

    restricted_proto = search_result_to_urn_metadata(restricted)
    assert restricted_proto.availability == ProtoUrnAvailability.URN_AVAILABILITY_RESTRICTED
    assert restricted_proto.can_request_access is True
    assert restricted_proto.title == ""
    assert dict(restricted_proto.metadata) == {}

    deleted_proto = search_result_to_urn_metadata(result[deleted_urn])
    assert deleted_proto.availability == ProtoUrnAvailability.URN_AVAILABILITY_DELETED
    assert deleted_proto.urn_status == "DELETED"
    assert deleted_proto.metadata["urn_status"] == "DELETED"

    resolver.enrich_live_state.assert_awaited_once()
    enriched = resolver.enrich_live_state.await_args.args[0]
    assert set(enriched) == {available_urn}


async def test_postgres_failure_returns_only_unavailable_results(
    monkeypatch,
    resolver: SearchOperations,
) -> None:
    organization_id = generate_id()
    urn = _urn(ContentType.NOTE)
    monkeypatch.setattr(
        operations_module,
        "get_raw_documents_by_urns",
        AsyncMock(
            return_value=UrnLookupResult(
                documents={urn: _document(urn, organization_id)},
                failed_urns=frozenset(),
            )
        ),
    )
    resolver.resource_access.resolve.side_effect = RuntimeError("database unavailable")

    result = await resolver.resolve_urns(generate_id(), organization_id, [urn])

    assert result[urn].availability == UrnAvailability.UNAVAILABLE
    assert result[urn].title == ""
    resolver.enrich_live_state.assert_not_awaited()


@pytest.mark.parametrize("requestable", [False, True])
async def test_requestability_comes_only_from_postgres_target(
    monkeypatch,
    resolver: SearchOperations,
    requestable: bool,
) -> None:
    organization_id = generate_id()
    urn = _urn(ContentType.TASK)
    monkeypatch.setattr(
        operations_module,
        "get_raw_documents_by_urns",
        AsyncMock(
            return_value=UrnLookupResult(
                documents={urn: _document(urn, organization_id)},
                failed_urns=frozenset(),
            )
        ),
    )
    decision = _decision(urn, requestable=requestable)
    resolver.resource_access.resolve.return_value = {decision.key: decision}

    result = await resolver.resolve_urns(generate_id(), organization_id, [urn])

    assert result[urn].availability == UrnAvailability.RESTRICTED
    assert result[urn].can_request_access is requestable
