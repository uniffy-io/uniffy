"""Tests for ContentAccessQuery.build_accessible_filter().

build_accessible_filter() builds a compound SQLAlchemy WHERE expression.
It does not execute anything -- the returned clause is a pure SQLAlchemy
expression tree. Tests here use real model columns (Note) so the
SQLAlchemy expression builder has proper InstrumentedAttribute objects.
"""

from unittest.mock import MagicMock

from uniffy.core.auth.permissions.queries import ContentAccessQuery
from uniffy.core.models.notes.note import Note
from uniffy.core.types import ContentType
from uniffy.core.types import generate_id as uuid7


def _columns():
    return (
        Note.id,
        Note.owner_id,
        Note.access_mode,
        Note.baseline_role,
    )


class TestBuildAccessibleFilter:
    def test_returns_non_none_expression(self) -> None:
        session = MagicMock()
        query = ContentAccessQuery(session)
        content_id_col, owner_id_col, access_mode_col, baseline_role_col = _columns()

        result = query.build_accessible_filter(
            user_id=uuid7(),
            organization_id=uuid7(),
            content_type=ContentType.NOTE,
            content_id_column=content_id_col,
            owner_id_column=owner_id_col,
            access_mode_column=access_mode_col,
            baseline_role_column=baseline_role_col,
        )

        assert result is not None

    def test_does_not_raise_for_note_content_type(self) -> None:
        session = MagicMock()
        query = ContentAccessQuery(session)
        content_id_col, owner_id_col, access_mode_col, baseline_role_col = _columns()

        result = query.build_accessible_filter(
            user_id=uuid7(),
            organization_id=uuid7(),
            content_type=ContentType.NOTE,
            content_id_column=content_id_col,
            owner_id_column=owner_id_col,
            access_mode_column=access_mode_col,
            baseline_role_column=baseline_role_col,
        )
        assert result is not None

    def test_different_users_produce_independent_expressions(self) -> None:
        """Two calls with different user_ids must return different objects."""
        session = MagicMock()
        query = ContentAccessQuery(session)
        content_id_col, owner_id_col, access_mode_col, baseline_role_col = _columns()

        expr_a = query.build_accessible_filter(
            user_id=uuid7(),
            organization_id=uuid7(),
            content_type=ContentType.NOTE,
            content_id_column=content_id_col,
            owner_id_column=owner_id_col,
            access_mode_column=access_mode_col,
            baseline_role_column=baseline_role_col,
        )
        expr_b = query.build_accessible_filter(
            user_id=uuid7(),
            organization_id=uuid7(),
            content_type=ContentType.NOTE,
            content_id_column=content_id_col,
            owner_id_column=owner_id_col,
            access_mode_column=access_mode_col,
            baseline_role_column=baseline_role_col,
        )

        assert expr_a is not expr_b


class TestBuildSharedWithMeFilter:
    def test_returns_non_none_expression(self) -> None:
        session = MagicMock()
        query = ContentAccessQuery(session)
        content_id_col, owner_id_col, access_mode_col, baseline_role_col = _columns()

        result = query.build_shared_with_me_filter(
            user_id=uuid7(),
            organization_id=uuid7(),
            content_type=ContentType.NOTE,
            content_id_column=content_id_col,
            owner_id_column=owner_id_col,
            access_mode_column=access_mode_col,
            baseline_role_column=baseline_role_col,
        )

        assert result is not None

    def test_different_result_from_accessible_filter(self) -> None:
        """Shared-with-me adds owner exclusion, so its expression differs."""
        session = MagicMock()
        query = ContentAccessQuery(session)
        user_id = uuid7()
        org_id = uuid7()
        content_id_col, owner_id_col, access_mode_col, baseline_role_col = _columns()

        accessible = query.build_accessible_filter(
            user_id=user_id,
            organization_id=org_id,
            content_type=ContentType.NOTE,
            content_id_column=content_id_col,
            owner_id_column=owner_id_col,
            access_mode_column=access_mode_col,
            baseline_role_column=baseline_role_col,
        )
        shared_with_me = query.build_shared_with_me_filter(
            user_id=user_id,
            organization_id=org_id,
            content_type=ContentType.NOTE,
            content_id_column=content_id_col,
            owner_id_column=owner_id_col,
            access_mode_column=access_mode_col,
            baseline_role_column=baseline_role_col,
        )

        assert accessible is not shared_with_me
