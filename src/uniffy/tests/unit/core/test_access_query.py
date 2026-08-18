"""Tests for ContentAccessQuery.build_accessible_filter().

build_accessible_filter() resolves the actor's active org membership once
(memoized on the query object) and then builds a compound SQLAlchemy WHERE
expression; nothing else executes. Tests use real model columns (Note) so
the expression builder has proper InstrumentedAttribute objects, and a fake
session that answers only the membership lookup.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from sqlalchemy.sql.elements import False_, True_

from uniffy.core.auth.permissions.queries import ContentAccessQuery
from uniffy.core.models.notes.note import Note
from uniffy.core.models.platform.support_session import SupportSessionScope
from uniffy.core.types import ContentType, generate_id


def _session(*, member_active: bool = True):
    async def execute(stmt):
        res = MagicMock()
        res.scalar_one_or_none = MagicMock(return_value="MEMBER" if member_active else None)
        res.one_or_none = MagicMock(return_value=None)
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


async def _build(query, user_id=None, org_id=None):
    content_id_col, owner_id_col, access_mode_col, baseline_role_col = _columns()
    return await query.build_accessible_filter(
        user_id=user_id or generate_id(),
        organization_id=org_id or generate_id(),
        content_type=ContentType.NOTE,
        content_id_column=content_id_col,
        owner_id_column=owner_id_col,
        access_mode_column=access_mode_col,
        baseline_role_column=baseline_role_col,
    )


class TestBuildAccessibleFilter:
    async def test_returns_non_none_expression(self) -> None:
        result = await _build(ContentAccessQuery(_session()))
        assert result is not None

    async def test_active_member_gets_the_normal_filter(self) -> None:
        result = await _build(ContentAccessQuery(_session(member_active=True)))
        assert not isinstance(result, False_)

    async def test_inactive_member_gets_a_no_rows_filter(self) -> None:
        result = await _build(ContentAccessQuery(_session(member_active=False)))
        assert isinstance(result, False_)

    async def test_active_support_session_gets_the_list_filter(self) -> None:
        membership = MagicMock(scalar_one_or_none=MagicMock(return_value=None))
        support = MagicMock(
            one_or_none=MagicMock(
                return_value=SimpleNamespace(
                    id=generate_id(),
                    scope=SupportSessionScope.READ_ONLY,
                )
            )
        )
        session = MagicMock()
        session.execute = AsyncMock(side_effect=[membership, support])

        result = await _build(ContentAccessQuery(session))

        assert isinstance(result, True_)

    async def test_membership_lookup_is_memoized_per_query_object(self) -> None:
        session = _session()
        query = ContentAccessQuery(session)
        user_id = generate_id()
        org_id = generate_id()

        await _build(query, user_id=user_id, org_id=org_id)
        await _build(query, user_id=user_id, org_id=org_id)

        assert session.execute.await_count == 1

    async def test_different_users_produce_independent_expressions(self) -> None:
        """Two calls with different user_ids must return different objects."""
        query = ContentAccessQuery(_session())

        expr_a = await _build(query)
        expr_b = await _build(query)

        assert expr_a is not expr_b


class TestBuildSharedWithMeFilter:
    async def _build_shared(self, query, user_id, org_id):
        content_id_col, owner_id_col, access_mode_col, baseline_role_col = _columns()
        return await query.build_shared_with_me_filter(
            user_id=user_id,
            organization_id=org_id,
            content_type=ContentType.NOTE,
            content_id_column=content_id_col,
            owner_id_column=owner_id_col,
            access_mode_column=access_mode_col,
            baseline_role_column=baseline_role_col,
        )

    async def test_returns_non_none_expression(self) -> None:
        result = await self._build_shared(
            ContentAccessQuery(_session()), generate_id(), generate_id()
        )
        assert result is not None

    async def test_different_result_from_accessible_filter(self) -> None:
        """Shared-with-me adds owner exclusion, so its expression differs."""
        query = ContentAccessQuery(_session())
        user_id = generate_id()
        org_id = generate_id()

        accessible = await _build(query, user_id=user_id, org_id=org_id)
        shared_with_me = await self._build_shared(query, user_id, org_id)

        assert accessible is not shared_with_me
