"""Tests for the tag visibility filter and SQL predicate.

The filter is now a thin facade over
:func:`get_visible_tag_ids` which is itself cached in Valkey. The tests
patch the cache helper and verify the filter intersects correctly. The
SQL predicate tests verify the org-admin short-circuit and the
``IN(...)`` clause shape.
"""

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.models.tags.tag import Tag
from uniffy.core.types import generate_id
from uniffy.domains.tags.visibility import (
    TagVisibilityFilter,
    build_assignment_visibility_predicate,
    build_tag_visibility_predicate,
)


def _run(coro):
    return asyncio.run(coro)


def _make_tag(*, organization_id=None, created_by=None, name="docs") -> Tag:
    return Tag(
        id=generate_id(),
        organization_id=organization_id or generate_id(),
        name=name,
        slug=name.lower(),
        created_by=created_by,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )


class TestVisibilityFilter:
    def test_org_admin_returns_all_tags(self) -> None:
        org_id = generate_id()
        user_id = generate_id()
        session = MagicMock()
        visibility = TagVisibilityFilter(session, user_id, org_id)
        tags = [_make_tag(organization_id=org_id) for _ in range(3)]

        with patch(
            "uniffy.domains.tags.visibility.filter.get_visible_tag_ids",
            new=AsyncMock(return_value=None),
        ):
            result = _run(visibility.filter_visible(tags))

        assert result == tags

    def test_intersects_against_cached_visible_set(self) -> None:
        org_id = generate_id()
        user_id = generate_id()
        session = MagicMock()
        visibility = TagVisibilityFilter(session, user_id, org_id)

        visible_tag = _make_tag(organization_id=org_id)
        invisible_tag = _make_tag(organization_id=org_id)

        with patch(
            "uniffy.domains.tags.visibility.filter.get_visible_tag_ids",
            new=AsyncMock(return_value={visible_tag.id}),
        ):
            result = _run(visibility.filter_visible([visible_tag, invisible_tag]))

        assert result == [visible_tag]

    def test_empty_visible_set_drops_everything(self) -> None:
        org_id = generate_id()
        user_id = generate_id()
        session = MagicMock()
        visibility = TagVisibilityFilter(session, user_id, org_id)
        tags = [_make_tag(organization_id=org_id) for _ in range(2)]

        with patch(
            "uniffy.domains.tags.visibility.filter.get_visible_tag_ids",
            new=AsyncMock(return_value=set()),
        ):
            result = _run(visibility.filter_visible(tags))

        assert result == []

    def test_visible_id_set_admin_returns_every_input(self) -> None:
        org_id = generate_id()
        user_id = generate_id()
        session = MagicMock()
        visibility = TagVisibilityFilter(session, user_id, org_id)
        tags = [_make_tag(organization_id=org_id) for _ in range(2)]

        with patch(
            "uniffy.domains.tags.visibility.filter.get_visible_tag_ids",
            new=AsyncMock(return_value=None),
        ):
            ids = _run(visibility.visible_id_set(tags))

        assert ids == {t.id for t in tags}

    def test_is_visible_admin_short_circuit(self) -> None:
        org_id = generate_id()
        user_id = generate_id()
        session = MagicMock()
        visibility = TagVisibilityFilter(session, user_id, org_id)
        tag = _make_tag(organization_id=org_id, created_by=generate_id())

        with patch(
            "uniffy.domains.tags.visibility.filter.get_visible_tag_ids",
            new=AsyncMock(return_value=None),
        ):
            assert _run(visibility.is_visible(tag))

    def test_is_visible_membership(self) -> None:
        org_id = generate_id()
        user_id = generate_id()
        session = MagicMock()
        visibility = TagVisibilityFilter(session, user_id, org_id)
        visible_tag = _make_tag(organization_id=org_id)
        invisible_tag = _make_tag(organization_id=org_id)

        with patch(
            "uniffy.domains.tags.visibility.filter.get_visible_tag_ids",
            new=AsyncMock(return_value={visible_tag.id}),
        ):
            assert _run(visibility.is_visible(visible_tag)) is True
            assert _run(visibility.is_visible(invisible_tag)) is False


class TestBuildTagVisibilityPredicate:
    def test_admin_returns_none(self) -> None:
        session = MagicMock()
        with patch(
            "uniffy.domains.tags.visibility.predicate.get_visible_tag_ids",
            new=AsyncMock(return_value=None),
        ):
            result = _run(
                build_tag_visibility_predicate(
                    session,
                    user_id=generate_id(),
                    organization_id=generate_id(),
                )
            )

        assert result is None

    def test_empty_visible_set_returns_false_literal(self) -> None:
        from sqlalchemy.sql.elements import False_

        session = MagicMock()
        with patch(
            "uniffy.domains.tags.visibility.predicate.get_visible_tag_ids",
            new=AsyncMock(return_value=set()),
        ):
            result = _run(
                build_tag_visibility_predicate(
                    session,
                    user_id=generate_id(),
                    organization_id=generate_id(),
                )
            )

        assert isinstance(result, False_)

    def test_returns_in_clause_when_set_present(self) -> None:
        from sqlalchemy.sql.elements import BinaryExpression

        session = MagicMock()
        ids = {generate_id() for _ in range(3)}
        with patch(
            "uniffy.domains.tags.visibility.predicate.get_visible_tag_ids",
            new=AsyncMock(return_value=ids),
        ):
            result = _run(
                build_tag_visibility_predicate(
                    session,
                    user_id=generate_id(),
                    organization_id=generate_id(),
                )
            )

        assert isinstance(result, BinaryExpression)
        compiled = str(result.compile(compile_kwargs={"literal_binds": False}))
        assert "tags.id IN" in compiled


class TestBuildAssignmentVisibilityPredicate:
    def test_org_admin_collapses_to_none(self) -> None:
        session = MagicMock()
        with patch(
            "uniffy.domains.tags.visibility.predicate.get_visible_content_ids_by_type",
            new=AsyncMock(return_value=None),
        ):
            result = _run(
                build_assignment_visibility_predicate(
                    session,
                    user_id=generate_id(),
                    organization_id=generate_id(),
                )
            )

        assert result is None

    def test_returns_or_branches_per_type(self) -> None:
        from sqlalchemy.sql.elements import BooleanClauseList

        note_id = generate_id()
        # Return a real set for NOTE, empty for everything else.

        async def fake_visible(_session, *, user_id, organization_id, content_type):
            return {note_id} if content_type.value == "NOTE" else set()

        session = MagicMock()
        with patch(
            "uniffy.domains.tags.visibility.predicate.get_visible_content_ids_by_type",
            new=AsyncMock(side_effect=fake_visible),
        ):
            result = _run(
                build_assignment_visibility_predicate(
                    session,
                    user_id=generate_id(),
                    organization_id=generate_id(),
                )
            )

        assert isinstance(result, BooleanClauseList)
        compiled = str(result.compile(compile_kwargs={"literal_binds": False}))
        assert "tag_assignments.content_type" in compiled

    def test_empty_when_nothing_visible(self) -> None:
        from sqlalchemy.sql.elements import False_

        async def fake_visible(_session, **_kwargs):
            return set()

        session = MagicMock()
        with patch(
            "uniffy.domains.tags.visibility.predicate.get_visible_content_ids_by_type",
            new=AsyncMock(side_effect=fake_visible),
        ):
            result = _run(
                build_assignment_visibility_predicate(
                    session,
                    user_id=generate_id(),
                    organization_id=generate_id(),
                )
            )

        assert isinstance(result, False_)
