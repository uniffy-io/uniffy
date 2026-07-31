"""Unit tests for the tags explorer.

Covers saved-filter CRUD plumbing, criteria-aware ``list_content`` shape,
presets seed values, and the proto criteria converter. AsyncMock-driven so
the suite runs without a real Postgres / Meilisearch / Valkey.
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
from uniffy_proto.common.v1.common_pb2 import ContentType as ProtoContentType
from uniffy_proto.tags.v1.tags_pb2 import TagFilterCriteria as ProtoTagFilterCriteria

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.tags.saved_filter import SavedTagFilter
from uniffy.core.types import ContentType, generate_id
from uniffy.domains.tags.filters.converters import (
    criteria_from_proto,
    criteria_to_proto,
)
from uniffy.domains.tags.filters.operations import SavedTagFilterOperations
from uniffy.domains.tags.filters.presets import DEFAULT_TAG_FILTER_PRESETS
from uniffy.domains.tags.operations import SOURCE_INLINE, SOURCE_MANUAL


def _make_filter(
    *,
    user_id: UUID | None = None,
    organization_id: UUID | None = None,
    is_preset: bool = False,
    name: str = "Quarter",
    criteria: dict | None = None,
) -> SavedTagFilter:
    now = datetime.now(UTC)
    return SavedTagFilter(
        id=generate_id(),
        user_id=user_id or generate_id(),
        organization_id=organization_id or generate_id(),
        name=name,
        description="",
        icon=None,
        criteria=criteria or {},
        sort_by="count",
        sort_order="desc",
        is_preset=is_preset,
        created_at=now,
        updated_at=now,
    )


def _make_session_for_filter(saved_filter: SavedTagFilter) -> MagicMock:
    session = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    session.delete = AsyncMock()
    session.add = MagicMock()
    result = MagicMock()
    scalars = MagicMock()
    scalars.first.return_value = saved_filter
    scalars.all.return_value = [saved_filter]
    result.scalars.return_value = scalars
    session.execute = AsyncMock(return_value=result)
    return session


async def test_get_by_id_blocks_other_user_non_preset() -> None:
    sf = _make_filter()
    session = _make_session_for_filter(sf)
    ops = SavedTagFilterOperations(session)
    other_user_id = generate_id()

    with pytest.raises(PermissionDeniedError):
        await ops.get_by_id(
            user_id=other_user_id,
            organization_id=sf.organization_id,
            filter_id=sf.id,
        )


async def test_get_by_id_returns_preset_for_any_user() -> None:
    sf = _make_filter(is_preset=True)
    session = _make_session_for_filter(sf)
    ops = SavedTagFilterOperations(session)
    other_user_id = generate_id()

    out = await ops.get_by_id(
        user_id=other_user_id,
        organization_id=sf.organization_id,
        filter_id=sf.id,
    )
    assert out is sf


async def test_get_by_id_raises_not_found() -> None:
    session = MagicMock()
    result = MagicMock()
    scalars = MagicMock()
    scalars.first.return_value = None
    result.scalars.return_value = scalars
    session.execute = AsyncMock(return_value=result)
    ops = SavedTagFilterOperations(session)

    with pytest.raises(NotFoundError):
        await ops.get_by_id(
            user_id=generate_id(),
            organization_id=generate_id(),
            filter_id=generate_id(),
        )


async def test_update_preset_rejected() -> None:
    sf = _make_filter(is_preset=True)
    session = _make_session_for_filter(sf)
    ops = SavedTagFilterOperations(session)

    with pytest.raises(PermissionDeniedError):
        await ops.update(
            user_id=sf.user_id,
            organization_id=sf.organization_id,
            filter_id=sf.id,
            name="renamed",
        )


async def test_delete_preset_rejected() -> None:
    sf = _make_filter(is_preset=True)
    session = _make_session_for_filter(sf)
    ops = SavedTagFilterOperations(session)

    with pytest.raises(PermissionDeniedError):
        await ops.delete(
            user_id=sf.user_id,
            organization_id=sf.organization_id,
            filter_id=sf.id,
        )


async def test_create_persists_normalised_fields() -> None:
    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    ops = SavedTagFilterOperations(session)

    user_id = generate_id()
    org_id = generate_id()
    out = await ops.create(
        user_id=user_id,
        organization_id=org_id,
        name="  Sprint planning ",
        description="latest",
        criteria={"tag_ids": ["a"]},
        icon={"type": "icon", "value": "Funnel"},
    )

    assert out.name == "Sprint planning"
    assert out.user_id == user_id
    assert out.organization_id == org_id
    assert out.is_preset is False
    assert out.criteria == {"tag_ids": ["a"]}
    assert out.icon == {"type": "icon", "value": "Funnel"}
    session.add.assert_called_once()
    session.commit.assert_awaited()


def test_criteria_round_trip_basic() -> None:
    proto = ProtoTagFilterCriteria(
        tag_ids=["a", "b"],
        owner_ids=["u1"],
        sources=[SOURCE_MANUAL],
    )
    proto.content_types.extend([ProtoContentType.CONTENT_TYPE_NOTE])
    proto.untagged_only = False

    out = criteria_from_proto(proto)
    assert out["tag_ids"] == ["a", "b"]
    assert out["owner_ids"] == ["u1"]
    assert out["sources"] == [SOURCE_MANUAL]
    assert out["content_types"] == [ContentType.NOTE.value]
    assert "untagged_only" not in out

    proto2 = criteria_to_proto(out)
    assert list(proto2.tag_ids) == ["a", "b"]
    assert list(proto2.owner_ids) == ["u1"]
    assert list(proto2.sources) == [SOURCE_MANUAL]
    assert list(proto2.content_types) == [ProtoContentType.CONTENT_TYPE_NOTE]


def test_criteria_strips_unknown_sources() -> None:
    proto = ProtoTagFilterCriteria(sources=["manual", "bogus", "inline"])
    out = criteria_from_proto(proto)
    assert out["sources"] == [SOURCE_MANUAL, SOURCE_INLINE]


def test_criteria_untagged_only_round_trip() -> None:
    proto = ProtoTagFilterCriteria(untagged_only=True)
    out = criteria_from_proto(proto)
    assert out == {"untagged_only": True}
    proto2 = criteria_to_proto(out)
    assert proto2.untagged_only is True


def test_criteria_to_proto_handles_iso_dates() -> None:
    started = datetime(2026, 1, 1, tzinfo=UTC).isoformat()
    proto = criteria_to_proto({"created_after": started})
    assert proto.HasField("created_after")
    assert proto.created_after.seconds > 0


def test_default_presets_shape() -> None:
    names = [p["name"] for p in DEFAULT_TAG_FILTER_PRESETS]
    assert "Untagged content" in names
    assert "Auto-tagged" in names
    assert "Manual only" in names
    assert "My recent tags" in names

    for preset in DEFAULT_TAG_FILTER_PRESETS:
        assert preset["icon"]["type"] in {"icon", "emoji"}
        assert preset["sort_by"] in {"count", "alpha", "updated"}
        assert preset["sort_order"] in {"asc", "desc"}

    untagged = next(
        p for p in DEFAULT_TAG_FILTER_PRESETS if p["name"] == "Untagged content"
    )
    assert untagged["criteria"] == {"untagged_only": True}

    auto = next(p for p in DEFAULT_TAG_FILTER_PRESETS if p["name"] == "Auto-tagged")
    assert auto["criteria"]["sources"] == [SOURCE_INLINE]

    manual = next(p for p in DEFAULT_TAG_FILTER_PRESETS if p["name"] == "Manual only")
    assert manual["criteria"]["sources"] == [SOURCE_MANUAL]


def test_my_recent_tags_uses_recent_window() -> None:
    recent = next(
        p for p in DEFAULT_TAG_FILTER_PRESETS if p["name"] == "My recent tags"
    )
    after = recent["criteria"]["created_after"]
    parsed = datetime.fromisoformat(after)
    delta = datetime.now(UTC) - parsed
    assert timedelta(days=29) < delta < timedelta(days=31)
