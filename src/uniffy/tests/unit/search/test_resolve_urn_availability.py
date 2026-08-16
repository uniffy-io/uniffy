from unittest.mock import AsyncMock, MagicMock

import pytest
from uniffy_proto.search.v1.search_pb2 import UrnAvailability as ProtoUrnAvailability

from uniffy.core.content.reference_state import ReferenceRowState
from uniffy.core.errors import PermissionDeniedError
from uniffy.core.types import AccessMode, ContentType, generate_id
from uniffy.domains.search import operations as operations_module
from uniffy.domains.search.converters import search_result_to_urn_metadata
from uniffy.domains.search.operations import SearchOperations
from uniffy.domains.search.queries import SearchResult, UrnAvailability, UrnLookupResult


def _urn(content_type: ContentType) -> str:
    return f"urn:uniffy:content:{content_type.value}:{generate_id()}"


def _document(
    urn: str,
    organization_id,
    *,
    title: str = "Private title",
    metadata: dict[str, str] | None = None,
) -> SearchResult:
    parsed_type = urn.split(":")[3].lower()
    return SearchResult(
        urn=urn,
        organization_id=organization_id,
        title=title,
        description="Private description",
        entity_type=parsed_type,
        url_path="/private/path",
        access_mode=AccessMode.OWNER_ONLY.value,
        baseline_role=None,
        owner_id=generate_id(),
        tags=["secret"],
        metadata=metadata or {"secret": "value"},
        updated_at=None,
        rank_score=1.0,
        search_score=None,
    )


@pytest.fixture
def resolver() -> SearchOperations:
    operations = SearchOperations(MagicMock())
    operations._require_org_member = AsyncMock()
    operations._get_user_group_ids = AsyncMock(return_value=[])
    operations._enrich_live_state = AsyncMock()
    return operations


async def test_resolve_classifies_each_availability_without_leaking_metadata(
    monkeypatch,
    resolver: SearchOperations,
) -> None:
    organization_id = generate_id()
    available_urn = _urn(ContentType.NOTE)
    restricted_urn = _urn(ContentType.NOTE)
    deleted_urn = _urn(ContentType.FILE)
    live_unindexed_urn = _urn(ContentType.PROJECT)
    filtered_failure_urn = _urn(ContentType.TASK)
    raw_failure_urn = _urn(ContentType.CHAT)
    invalid_urn = "not-a-urn"

    available = _document(available_urn, organization_id, title="Visible")
    restricted_raw = _document(restricted_urn, organization_id)
    monkeypatch.setattr(
        operations_module,
        "get_permission_filtered_documents_by_urns",
        AsyncMock(
            return_value=UrnLookupResult(
                documents={available_urn: available},
                failed_urns=frozenset({filtered_failure_urn}),
            )
        ),
    )
    monkeypatch.setattr(
        operations_module,
        "get_raw_documents_by_urns",
        AsyncMock(
            return_value=UrnLookupResult(
                documents={restricted_urn: restricted_raw},
                failed_urns=frozenset({raw_failure_urn}),
            )
        ),
    )
    reference_probe = AsyncMock(
        return_value={
            deleted_urn: ReferenceRowState.MISSING,
            live_unindexed_urn: ReferenceRowState.LIVE,
        }
    )
    monkeypatch.setattr(
        operations_module,
        "get_authoritative_reference_states",
        reference_probe,
    )

    result = await resolver.resolve_urns(
        generate_id(),
        organization_id,
        [
            available_urn,
            restricted_urn,
            deleted_urn,
            live_unindexed_urn,
            filtered_failure_urn,
            raw_failure_urn,
            invalid_urn,
        ],
    )

    assert result[available_urn].availability == UrnAvailability.AVAILABLE
    assert result[restricted_urn].availability == UrnAvailability.RESTRICTED
    assert result[restricted_urn].can_request_access is True
    assert result[deleted_urn].availability == UrnAvailability.DELETED
    assert result[live_unindexed_urn].availability == UrnAvailability.UNAVAILABLE
    assert result[filtered_failure_urn].availability == UrnAvailability.UNAVAILABLE
    assert result[raw_failure_urn].availability == UrnAvailability.UNAVAILABLE
    assert result[invalid_urn].availability == UrnAvailability.UNAVAILABLE

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
    assert restricted_proto.description == ""
    assert restricted_proto.url == ""
    assert dict(restricted_proto.metadata) == {}
    assert restricted_proto.urn_status == ""

    deleted_proto = search_result_to_urn_metadata(result[deleted_urn])
    assert deleted_proto.availability == ProtoUrnAvailability.URN_AVAILABILITY_DELETED
    assert deleted_proto.urn_status == "DELETED"
    assert deleted_proto.metadata["urn_status"] == "DELETED"

    probed_urns = reference_probe.await_args.args[2]
    assert set(probed_urns) == {deleted_urn, live_unindexed_urn}


async def test_filtered_transport_failure_skips_raw_and_database_fallback(
    monkeypatch,
    resolver: SearchOperations,
) -> None:
    organization_id = generate_id()
    urn = _urn(ContentType.NOTE)
    monkeypatch.setattr(
        operations_module,
        "get_permission_filtered_documents_by_urns",
        AsyncMock(
            return_value=UrnLookupResult(documents={}, failed_urns=frozenset({urn})),
        ),
    )
    raw_lookup = AsyncMock()
    reference_probe = AsyncMock()
    monkeypatch.setattr(operations_module, "get_raw_documents_by_urns", raw_lookup)
    monkeypatch.setattr(
        operations_module,
        "get_authoritative_reference_states",
        reference_probe,
    )

    result = await resolver.resolve_urns(generate_id(), organization_id, [urn])

    assert result[urn].availability == UrnAvailability.UNAVAILABLE
    raw_lookup.assert_not_awaited()
    reference_probe.assert_not_awaited()


async def test_membership_gate_runs_before_search(monkeypatch) -> None:
    resolver = SearchOperations(MagicMock())
    resolver._require_org_member = AsyncMock(
        side_effect=PermissionDeniedError("Requires active organization membership"),
    )
    filtered_lookup = AsyncMock()
    monkeypatch.setattr(
        operations_module,
        "get_permission_filtered_documents_by_urns",
        filtered_lookup,
    )

    with pytest.raises(PermissionDeniedError):
        await resolver.resolve_urns(generate_id(), generate_id(), [_urn(ContentType.NOTE)])

    filtered_lookup.assert_not_awaited()


@pytest.mark.parametrize(
    ("content_type", "metadata", "expected"),
    [
        (ContentType.NOTE, {}, True),
        (ContentType.TASK, {"project_id": str(generate_id())}, True),
        (ContentType.TASK, {}, False),
        (ContentType.CHAT, {"channel_type": "PRIVATE"}, True),
        (ContentType.CHAT, {"channel_type": "PUBLIC"}, False),
        (
            ContentType.CHAT_MESSAGE,
            {"channel_type": "PRIVATE", "channel_id": str(generate_id())},
            True,
        ),
        (ContentType.USER, {}, False),
        (ContentType.TEAM, {}, False),
        (ContentType.TAG, {}, False),
        (ContentType.AGENT_CHAT, {"channel_type": "DIRECT"}, False),
        (ContentType.AGENT_FOLDER, {}, False),
    ],
)
async def test_restricted_requestability_matrix(
    monkeypatch,
    resolver: SearchOperations,
    content_type: ContentType,
    metadata: dict[str, str],
    expected: bool,
) -> None:
    organization_id = generate_id()
    urn = _urn(content_type)
    monkeypatch.setattr(
        operations_module,
        "get_permission_filtered_documents_by_urns",
        AsyncMock(return_value=UrnLookupResult(documents={}, failed_urns=frozenset())),
    )
    monkeypatch.setattr(
        operations_module,
        "get_raw_documents_by_urns",
        AsyncMock(
            return_value=UrnLookupResult(
                documents={urn: _document(urn, organization_id, metadata=metadata)},
                failed_urns=frozenset(),
            )
        ),
    )

    result = await resolver.resolve_urns(generate_id(), organization_id, [urn])

    assert result[urn].availability == UrnAvailability.RESTRICTED
    assert result[urn].can_request_access is expected
