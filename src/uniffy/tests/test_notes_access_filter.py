"""Regression guard: org/domain admins must NOT bypass the access filter when
listing notes.

``list_notes`` powers the personal notes sidebar. An admin browsing their own
sidebar must see only content they can actually access - never another member's
OWNER_ONLY note. The bug this guards against was a silent admin bypass that
returned every org note unfiltered, which then surfaced as other people's
private notes under "Shared With Me".

Same MagicMock harness as ``test_projects_hierarchy_filters.py``: no real
database. We intercept ``session.execute`` and compile the constructed query to
SQL text, then assert the access-filter predicates are present.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from uniffy.core.auth.permissions.queries import ContentAccessQuery
from uniffy.core.types import ContentType
from uniffy.domains.notes.operations import NoteOperations

_MEMBERS_TABLE = "permissions_content_members"


def _run(coro):
    return asyncio.run(coro)


def _make_ops(*, is_admin: bool) -> NoteOperations:
    ops = NoteOperations.__new__(NoteOperations)
    ops.session = MagicMock()
    ops.content_type = ContentType.NOTE
    ops.access_query = ContentAccessQuery(ops.session)
    ops.permission_checker = MagicMock()
    ops.permission_checker.is_org_admin = AsyncMock(return_value=is_admin)
    ops.permission_checker.is_domain_admin = AsyncMock(return_value=is_admin)
    return ops


def _capture_executes(ops: NoteOperations) -> list[str]:
    captured: list[str] = []

    async def execute(stmt):  # noqa: ANN001 - SQLAlchemy statement
        try:
            compiled = stmt.compile(compile_kwargs={"literal_binds": True})
            captured.append(str(compiled).lower())
        except Exception:
            captured.append(str(stmt).lower())
        result = MagicMock()
        result.scalar.return_value = 0
        result.scalars.return_value.all.return_value = []
        return result

    ops.session.execute = AsyncMock(side_effect=execute)
    return captured


def test_org_admin_still_gets_access_filter() -> None:
    ops = _make_ops(is_admin=True)
    captured = _capture_executes(ops)

    _run(ops.list_notes(user_id=uuid4(), organization_id=uuid4()))

    # The access filter joins the content-members table for explicit/blocked
    # grants; its presence proves the admin did not bypass the filter.
    assert any(_MEMBERS_TABLE in sql for sql in captured)


def test_regular_member_gets_access_filter() -> None:
    ops = _make_ops(is_admin=False)
    captured = _capture_executes(ops)

    _run(ops.list_notes(user_id=uuid4(), organization_id=uuid4()))

    assert any(_MEMBERS_TABLE in sql for sql in captured)


def test_personal_only_is_owner_scoped_without_member_join() -> None:
    ops = _make_ops(is_admin=True)
    captured = _capture_executes(ops)
    user_id = uuid4()

    _run(ops.list_notes(user_id=user_id, organization_id=uuid4(), personal_only=True))

    data_sql = [sql for sql in captured if "owner_id" in sql]
    assert data_sql, "expected an owner-scoped predicate"
    assert all(_MEMBERS_TABLE not in sql for sql in captured)
