from dataclasses import fields
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.types import ContentType, generate_id
from uniffy.domains.permissions.resource_access import (
    ResourceAccessDecision,
    ResourceAccessPurpose,
    ResourceAccessResolver,
    ResourceKey,
    ResourceRowState,
)
from uniffy.domains.permissions.resource_access.registry import (
    NON_SEARCHABLE_CONTENT_TYPES,
    SEARCHABLE_CONTENT_TYPES,
)
from uniffy.domains.search.converters import ENTITY_TYPE_TO_PROTO


def test_every_search_result_type_has_an_authoritative_accessor() -> None:
    exposed = {ContentType(entity_type.upper()) for entity_type in ENTITY_TYPE_TO_PROTO}

    assert exposed == SEARCHABLE_CONTENT_TYPES
    assert not exposed & NON_SEARCHABLE_CONTENT_TYPES


def test_access_decisions_cannot_carry_display_metadata() -> None:
    assert {field.name for field in fields(ResourceAccessDecision)} == {
        "key",
        "row_state",
        "can_view",
        "role",
        "request_target",
    }


async def test_resolver_rejects_unbounded_candidate_batches() -> None:
    resolver = ResourceAccessResolver(MagicMock())
    keys = [ResourceKey(ContentType.NOTE, generate_id()) for _ in range(301)]

    with pytest.raises(ValueError, match="At most 300"):
        await resolver.resolve(
            actor_id=generate_id(),
            organization_id=generate_id(),
            keys=keys,
            purpose=ResourceAccessPurpose.SEARCH,
        )


async def test_list_pages_are_split_into_bounded_batches() -> None:
    resolver = ResourceAccessResolver(MagicMock())
    keys = [ResourceKey(ContentType.NOTE, generate_id()) for _ in range(500)]

    async def resolve_batch(*, keys, **_kwargs):
        return {
            key: ResourceAccessDecision(
                key=key,
                row_state=ResourceRowState.LIVE,
                can_view=True,
            )
            for key in keys
        }

    with patch.object(resolver, "resolve", new=AsyncMock(side_effect=resolve_batch)) as resolve:
        decisions = await resolver.resolve_page(
            actor_id=generate_id(),
            organization_id=generate_id(),
            keys=keys,
        )

    assert len(decisions) == 500
    assert [len(call.kwargs["keys"]) for call in resolve.await_args_list] == [300, 200]
