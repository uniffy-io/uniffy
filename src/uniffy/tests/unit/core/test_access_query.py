"""Tests for ContentAccessQuery.build_accessible_filter().

build_accessible_filter() resolves the actor's active org membership once
(memoized on the query object) and then builds a compound SQLAlchemy WHERE
expression; nothing else executes. Tests use real model columns (Note) so
the expression builder has proper InstrumentedAttribute objects, and a fake
session that answers only the membership lookup.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock

from sqlalchemy.sql.elements import False_

from uniffy.core.auth.permissions.queries import ContentAccessQuery
from uniffy.core.models.notes.note import Note
from uniffy.core.types import ContentType
from uniffy.core.types import generate_id as uuid7


def _run(coro):
    return asyncio.run(coro)


def _session(*, member_active: bool = True):
    async def execute(stmt):
        res = MagicMock()
        res.scalar_one_or_none = MagicMock(
            return_value="MEMBER" if member_active else None
        )
        return res

    session = MagicMock()
    session.execute = AsyncMock(side_effect=execute)
    return session


def _columns():
    return (
        Note.id,
        Note.owner_id,
        Note.access_mode,
        Note.baseline_role,
    )


def _build(query, user_id=None, org_id=None):
    content_id_col, owner_id_col, access_mode_col, baseline_role_col = _columns()
    return _run(
        query.build_accessible_filter(
            user_id=user_id or uuid7(),
            organization_id=org_id or uuid7(),
            content_type=ContentType.NOTE,
            content_id_column=content_id_col,
            owner_id_column=owner_id_col,
            access_mode_column=access_mode_col,
            baseline_role_column=baseline_role_col,
        )
    )


class TestBuildAccessibleFilter:
    def test_returns_non_none_expression(self) -> None:
        result = _build(ContentAccessQuery(_session()))
        assert result is not None

    def test_active_member_gets_the_normal_filter(self) -> None:
        result = _build(ContentAccessQuery(_session(member_active=True)))
        assert not isinstance(result, False_)

    def test_inactive_member_gets_a_no_rows_filter(self) -> None:
        result = _build(ContentAccessQuery(_session(member_active=False)))
        assert isinstance(result, False_)

    def test_membership_lookup_is_memoized_per_query_object(self) -> None:
        session = _session()
        query = ContentAccessQuery(session)
        user_id = uuid7()
        org_id = uuid7()

        _build(query, user_id=user_id, org_id=org_id)
        _build(query, user_id=user_id, org_id=org_id)

        assert session.execute.await_count == 1

    def test_different_users_produce_independent_expressions(self) -> None:
        """Two calls with different user_ids must return different objects."""
        query = ContentAccessQuery(_session())

        expr_a = _build(query)
        expr_b = _build(query)

        assert expr_a is not expr_b


class TestBuildSharedWithMeFilter:
    def _build_shared(self, query, user_id, org_id):
        content_id_col, owner_id_col, access_mode_col, baseline_role_col = _columns()
        return _run(
            query.build_shared_with_me_filter(
                user_id=user_id,
                organization_id=org_id,
                content_type=ContentType.NOTE,
                content_id_column=content_id_col,
                owner_id_column=owner_id_col,
                access_mode_column=access_mode_col,
                baseline_role_column=baseline_role_col,
            )
        )

    def test_returns_non_none_expression(self) -> None:
        result = self._build_shared(ContentAccessQuery(_session()), uuid7(), uuid7())
        assert result is not None

    def test_different_result_from_accessible_filter(self) -> None:
        """Shared-with-me adds owner exclusion, so its expression differs."""
        query = ContentAccessQuery(_session())
        user_id = uuid7()
        org_id = uuid7()

        accessible = _build(query, user_id=user_id, org_id=org_id)
        shared_with_me = self._build_shared(query, user_id, org_id)

        assert accessible is not shared_with_me
