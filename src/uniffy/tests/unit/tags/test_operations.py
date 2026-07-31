"""Unit tests for ``TagOperations`` business logic.

The operations class talks to Postgres + Valkey + Meilisearch. Tests
here mock those collaborators so they exercise the in-process logic
only: source-array merging, the manual cap, the merge-tags handoff,
URN parsing.
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.models.tags.tag import Tag, TagAssignment
from uniffy.core.types import ContentType, generate_id
from uniffy.domains.tags.operations import (
    MAX_MANUAL_TAGS_PER_CONTENT,
    SOURCE_INLINE,
    SOURCE_MANUAL,
    TagLimitExceededError,
    TagOperations,
    _content_type_from_urn,
)


def _make_tag(*, organization_id=None, name="docs", slug="docs") -> Tag:
    return Tag(
        id=generate_id(),
        organization_id=organization_id or generate_id(),
        name=name,
        slug=slug,
        created_by=generate_id(),
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )


def _make_assignment(
    tag_id, urn=None, sources=None
) -> TagAssignment:
    return TagAssignment(
        tag_id=tag_id,
        content_urn=urn or f"urn:uniffy:content:NOTE:{generate_id().hex}",
        content_type="NOTE",
        sources=list(sources or []),
        assigned_by=generate_id(),
        assigned_at=datetime.now(UTC),
    )


def _make_ops(session_mock) -> TagOperations:
    ops = TagOperations.__new__(TagOperations)
    ops.session = session_mock
    ops.indexer = MagicMock()
    ops.indexer.index = AsyncMock()
    ops.indexer.remove = AsyncMock()
    return ops


def _scalars_result(values: list) -> MagicMock:
    inner = MagicMock()
    inner.all = MagicMock(return_value=list(values))
    inner.first = MagicMock(return_value=values[0] if values else None)
    holder = MagicMock()
    holder.scalars = MagicMock(return_value=inner)
    holder.scalar = MagicMock(return_value=values[0] if values else None)
    holder.scalar_one_or_none = MagicMock(return_value=values[0] if values else None)
    holder.all = MagicMock(return_value=list(values))
    return holder


class TestUrnParsing:
    def test_valid_urn_returns_content_type(self) -> None:
        ct = _content_type_from_urn("urn:uniffy:content:NOTE:abc")
        assert ct == ContentType.NOTE

    def test_unknown_type_raises_validation(self) -> None:
        with pytest.raises(ValidationError):
            _content_type_from_urn("urn:uniffy:content:NOPE:abc")

    def test_malformed_raises_validation(self) -> None:
        with pytest.raises(ValidationError):
            _content_type_from_urn("not-a-urn")


class TestAssignSourceMerging:
    """``assign`` adds a source without spawning a duplicate row."""

    async def test_existing_inline_assignment_gets_manual_source_added(self) -> None:
        org_id = generate_id()
        actor_id = generate_id()
        tag = _make_tag(organization_id=org_id)
        urn = "urn:uniffy:content:NOTE:" + generate_id().hex
        existing = _make_assignment(tag.id, urn=urn, sources=[SOURCE_INLINE])

        session = MagicMock()
        session.commit = AsyncMock()

        results: list = [
            _scalars_result([tag]),
            _scalars_result([existing]),
            _scalars_result([0]),
            _scalars_result([]),
            _scalars_result([existing]),
        ]
        session.execute = AsyncMock(side_effect=results)
        session.add = MagicMock()
        session.delete = AsyncMock()

        ops = _make_ops(session)
        ops._reindex_tag_docs = AsyncMock(return_value={})
        with patch(
            "uniffy.domains.tags.operations.publish_tag_event", AsyncMock()
        ), patch(
            "uniffy.domains.tags.operations.cache_invalidate_many", AsyncMock()
        ):
            rows = await ops.assign(
                actor_id=actor_id,
                organization_id=org_id,
                content_urn=urn,
                tag_ids=[tag.id],
                source=SOURCE_MANUAL,
            )

        assert SOURCE_MANUAL in existing.sources
        assert SOURCE_INLINE in existing.sources
        assert rows  # last fetch returned the merged row
        session.commit.assert_awaited()


class TestAssignManualCap:
    """Manual cap rejects assignment that would push the URN past 20."""

    async def test_rejects_when_cap_exceeded(self) -> None:
        org_id = generate_id()
        actor_id = generate_id()
        tag = _make_tag(organization_id=org_id)
        urn = "urn:uniffy:content:NOTE:" + generate_id().hex

        session = MagicMock()
        session.commit = AsyncMock()
        session.add = MagicMock()
        session.delete = AsyncMock()

        results: list = [
            _scalars_result([tag]),
            _scalars_result([]),
            _scalars_result([MAX_MANUAL_TAGS_PER_CONTENT]),
        ]
        session.execute = AsyncMock(side_effect=results)

        ops = _make_ops(session)
        with patch(
            "uniffy.domains.tags.operations.publish_tag_event", AsyncMock()
        ), pytest.raises(TagLimitExceededError):
            await ops.assign(
                actor_id=actor_id,
                organization_id=org_id,
                content_urn=urn,
                tag_ids=[tag.id],
                source=SOURCE_MANUAL,
            )

    async def test_inline_source_exempt_from_cap(self) -> None:
        org_id = generate_id()
        actor_id = generate_id()
        tag = _make_tag(organization_id=org_id)
        urn = "urn:uniffy:content:NOTE:" + generate_id().hex

        session = MagicMock()
        session.commit = AsyncMock()
        session.add = MagicMock()
        session.delete = AsyncMock()

        results: list = [
            _scalars_result([tag]),
            _scalars_result([]),
            _scalars_result([]),
            _scalars_result([_make_assignment(tag.id, urn=urn, sources=[SOURCE_INLINE])]),
        ]
        session.execute = AsyncMock(side_effect=results)

        ops = _make_ops(session)
        ops._reindex_tag_docs = AsyncMock(return_value={})
        with patch(
            "uniffy.domains.tags.operations.publish_tag_event", AsyncMock()
        ), patch(
            "uniffy.domains.tags.operations.cache_invalidate_many", AsyncMock()
        ):
            await ops.assign(
                actor_id=actor_id,
                organization_id=org_id,
                content_urn=urn,
                tag_ids=[tag.id],
                source=SOURCE_INLINE,
            )

        session.add.assert_called()


class TestUnassignSourceSemantics:
    """Removing one source keeps the row alive when another remains."""

    async def test_removing_inline_preserves_manual_row(self) -> None:
        org_id = generate_id()
        urn = "urn:uniffy:content:NOTE:" + generate_id().hex
        tag_id = generate_id()
        row = _make_assignment(tag_id, urn=urn, sources=[SOURCE_MANUAL, SOURCE_INLINE])

        session = MagicMock()
        session.commit = AsyncMock()
        session.add = MagicMock()
        session.delete = AsyncMock()
        session.execute = AsyncMock(side_effect=[_scalars_result([row])])

        ops = _make_ops(session)
        ops._reindex_tag_docs = AsyncMock(return_value={})
        with patch(
            "uniffy.domains.tags.operations.publish_tag_event", AsyncMock()
        ), patch(
            "uniffy.domains.tags.operations.cache_invalidate_many", AsyncMock()
        ):
            removed = await ops.unassign(
                actor_id=generate_id(),
                organization_id=org_id,
                content_urn=urn,
                tag_ids=[tag_id],
                source=SOURCE_INLINE,
            )

        assert removed == []
        assert row.sources == [SOURCE_MANUAL]
        session.delete.assert_not_called()
        assert session.execute.await_count == 1

    async def test_removing_only_source_deletes_row(self) -> None:
        org_id = generate_id()
        urn = "urn:uniffy:content:NOTE:" + generate_id().hex
        tag_id = generate_id()
        row = _make_assignment(tag_id, urn=urn, sources=[SOURCE_INLINE])

        session = MagicMock()
        session.commit = AsyncMock()
        session.add = MagicMock()
        session.delete = AsyncMock()
        session.execute = AsyncMock(
            side_effect=[_scalars_result([row]), MagicMock()]
        )

        ops = _make_ops(session)
        ops._reindex_tag_docs = AsyncMock(return_value={})
        with patch(
            "uniffy.domains.tags.operations.publish_tag_event", AsyncMock()
        ), patch(
            "uniffy.domains.tags.operations.cache_invalidate_many", AsyncMock()
        ):
            removed = await ops.unassign(
                actor_id=generate_id(),
                organization_id=org_id,
                content_urn=urn,
                tag_ids=[tag_id],
                source=SOURCE_INLINE,
            )

        assert removed == [tag_id]
        session.delete.assert_not_called()
        assert session.execute.await_count == 2


class TestMergeTags:
    """``merge_tags`` folds source rows into target via SQL.

    The implementation issues an ``INSERT ... SELECT ... ON CONFLICT
    DO UPDATE SET sources = ARRAY(DISTINCT unnest(...))`` followed by
    bulk DELETEs against the source rows and the source tag. The unit
    test here mocks the SQL pipeline; row-level union semantics are
    asserted in integration tests against Postgres.
    """

    async def test_runs_insert_then_deletes(self) -> None:
        org_id = generate_id()
        actor_id = generate_id()
        source_tag = _make_tag(organization_id=org_id, slug="src")
        target_tag = _make_tag(organization_id=org_id, slug="dst")
        urn = "urn:uniffy:content:NOTE:" + generate_id().hex

        session = MagicMock()
        session.commit = AsyncMock()
        session.refresh = AsyncMock()
        session.add = MagicMock()
        session.delete = AsyncMock()

        moved_result = MagicMock()
        moved_result.all = MagicMock(return_value=[(urn,)])

        results: list = [
            _scalars_result([source_tag]),
            _scalars_result([target_tag]),
            moved_result,
            MagicMock(),
            MagicMock(),
            _scalars_result([0]),
        ]
        session.execute = AsyncMock(side_effect=results)

        ops = _make_ops(session)
        with patch(
            "uniffy.domains.tags.operations.publish_tag_event", AsyncMock()
        ), patch(
            "uniffy.domains.tags.operations.cache_delete", AsyncMock()
        ), patch.object(ops, "_remove_tag_entity", AsyncMock()), patch.object(
            ops, "_reindex_tag_docs", AsyncMock(return_value={})
        ):
            target = await ops.merge_tags(
                actor_id=actor_id,
                organization_id=org_id,
                source_tag_id=source_tag.id,
                target_tag_id=target_tag.id,
            )

        assert target is target_tag
        session.delete.assert_not_called()
        assert session.execute.await_count >= 5


class TestSourceValidation:
    async def test_rejects_unknown_source(self) -> None:
        ops = _make_ops(MagicMock())
        with pytest.raises(ValidationError):
            await ops.assign(
                actor_id=generate_id(),
                organization_id=generate_id(),
                content_urn="urn:uniffy:content:NOTE:abc",
                tag_ids=[generate_id()],
                source="bogus",
            )
