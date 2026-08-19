"""Tests for live PostgreSQL tag visibility filters and predicates."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.models.tags.tag import Tag
from uniffy.core.types import generate_id
from uniffy.domains.tags.visibility import (
    TagVisibilityFilter,
    build_assignment_visibility_predicate,
    build_tag_visibility_predicate,
)


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
    async def test_filter_returns_all_visible_tags(self) -> None:
        org_id = generate_id()
        user_id = generate_id()
        session = MagicMock()
        visibility = TagVisibilityFilter(session, user_id, org_id)
        tags = [_make_tag(organization_id=org_id) for _ in range(3)]

        with patch(
            "uniffy.domains.tags.visibility.filter.compute_visible_tag_ids",
            new=AsyncMock(return_value={tag.id for tag in tags}),
        ):
            result = await visibility.filter_visible(tags)

        assert result == tags

    async def test_intersects_against_live_visible_set(self) -> None:
        org_id = generate_id()
        user_id = generate_id()
        session = MagicMock()
        visibility = TagVisibilityFilter(session, user_id, org_id)

        visible_tag = _make_tag(organization_id=org_id)
        invisible_tag = _make_tag(organization_id=org_id)

        with patch(
            "uniffy.domains.tags.visibility.filter.compute_visible_tag_ids",
            new=AsyncMock(return_value={visible_tag.id}),
        ):
            result = await visibility.filter_visible([visible_tag, invisible_tag])

        assert result == [visible_tag]

    async def test_empty_visible_set_drops_everything(self) -> None:
        org_id = generate_id()
        user_id = generate_id()
        session = MagicMock()
        visibility = TagVisibilityFilter(session, user_id, org_id)
        tags = [_make_tag(organization_id=org_id) for _ in range(2)]

        with patch(
            "uniffy.domains.tags.visibility.filter.compute_visible_tag_ids",
            new=AsyncMock(return_value=set()),
        ):
            result = await visibility.filter_visible(tags)

        assert result == []

    async def test_visible_id_set_returns_every_visible_input(self) -> None:
        org_id = generate_id()
        user_id = generate_id()
        session = MagicMock()
        visibility = TagVisibilityFilter(session, user_id, org_id)
        tags = [_make_tag(organization_id=org_id) for _ in range(2)]

        with patch(
            "uniffy.domains.tags.visibility.filter.compute_visible_tag_ids",
            new=AsyncMock(return_value={tag.id for tag in tags}),
        ):
            ids = await visibility.visible_id_set(tags)

        assert ids == {t.id for t in tags}

    async def test_is_visible_true(self) -> None:
        org_id = generate_id()
        user_id = generate_id()
        session = MagicMock()
        visibility = TagVisibilityFilter(session, user_id, org_id)
        tag = _make_tag(organization_id=org_id, created_by=generate_id())

        with patch(
            "uniffy.domains.tags.visibility.filter.compute_visible_tag_ids",
            new=AsyncMock(return_value={tag.id}),
        ):
            assert await visibility.is_visible(tag)

    async def test_is_visible_membership(self) -> None:
        org_id = generate_id()
        user_id = generate_id()
        session = MagicMock()
        visibility = TagVisibilityFilter(session, user_id, org_id)
        visible_tag = _make_tag(organization_id=org_id)
        invisible_tag = _make_tag(organization_id=org_id)

        with patch(
            "uniffy.domains.tags.visibility.filter.compute_visible_tag_ids",
            new=AsyncMock(return_value={visible_tag.id}),
        ):
            assert await visibility.is_visible(visible_tag) is True
            assert await visibility.is_visible(invisible_tag) is False


class TestBuildTagVisibilityPredicate:
    async def test_visible_set_returns_in_clause(self) -> None:
        from sqlalchemy.sql.elements import BinaryExpression

        session = MagicMock()
        tag_id = generate_id()
        with patch(
            "uniffy.domains.tags.visibility.predicate.compute_visible_tag_ids",
            new=AsyncMock(return_value={tag_id}),
        ):
            result = await build_tag_visibility_predicate(
                session,
                user_id=generate_id(),
                organization_id=generate_id(),
            )

        assert isinstance(result, BinaryExpression)

    async def test_empty_visible_set_returns_false_literal(self) -> None:
        from sqlalchemy.sql.elements import False_

        session = MagicMock()
        with patch(
            "uniffy.domains.tags.visibility.predicate.compute_visible_tag_ids",
            new=AsyncMock(return_value=set()),
        ):
            result = await build_tag_visibility_predicate(
                session,
                user_id=generate_id(),
                organization_id=generate_id(),
            )

        assert isinstance(result, False_)

    async def test_returns_in_clause_when_set_present(self) -> None:
        from sqlalchemy.sql.elements import BinaryExpression

        session = MagicMock()
        ids = {generate_id() for _ in range(3)}
        with patch(
            "uniffy.domains.tags.visibility.predicate.compute_visible_tag_ids",
            new=AsyncMock(return_value=ids),
        ):
            result = await build_tag_visibility_predicate(
                session,
                user_id=generate_id(),
                organization_id=generate_id(),
            )

        assert isinstance(result, BinaryExpression)


class TestBuildAssignmentVisibilityPredicate:
    async def test_org_admin_collapses_to_none(self) -> None:
        session = MagicMock()
        with patch(
            "uniffy.domains.tags.visibility.predicate.compute_visible_content_ids_by_type",
            new=AsyncMock(return_value=None),
        ):
            result = await build_assignment_visibility_predicate(
                session,
                user_id=generate_id(),
                organization_id=generate_id(),
            )

        assert result is None

    async def test_returns_or_branches_per_type(self) -> None:
        from sqlalchemy.sql.elements import BooleanClauseList

        note_id = generate_id()
        # Return a real set for NOTE, empty for everything else.

        async def fake_visible(_session, *, user_id, organization_id, content_type):
            return {note_id} if content_type.value == "NOTE" else set()

        session = MagicMock()
        with patch(
            "uniffy.domains.tags.visibility.predicate.compute_visible_content_ids_by_type",
            new=AsyncMock(side_effect=fake_visible),
        ):
            result = await build_assignment_visibility_predicate(
                session,
                user_id=generate_id(),
                organization_id=generate_id(),
            )

        assert isinstance(result, BooleanClauseList)

    async def test_empty_when_nothing_visible(self) -> None:
        from sqlalchemy.sql.elements import False_

        async def fake_visible(_session, **_kwargs):
            return set()

        session = MagicMock()
        with patch(
            "uniffy.domains.tags.visibility.predicate.compute_visible_content_ids_by_type",
            new=AsyncMock(side_effect=fake_visible),
        ):
            result = await build_assignment_visibility_predicate(
                session,
                user_id=generate_id(),
                organization_id=generate_id(),
            )

        assert isinstance(result, False_)
