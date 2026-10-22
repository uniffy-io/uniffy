from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from uniffy.core.errors import PermissionDeniedError
from uniffy.domains.projects.time.access import TimeAccess

ORG = uuid4()
SUBJECT = uuid4()
MANAGER = uuid4()
LEAD = uuid4()
STRANGER = uuid4()


def _capturing_session(rows: list) -> tuple[AsyncMock, list]:
    captured: list = []

    async def execute(stmt):  # noqa: ANN001 - SQLAlchemy statement
        captured.append(stmt)
        result = MagicMock()
        result.all.return_value = rows
        return result

    return AsyncMock(side_effect=execute), captured


def _compiled(stmt) -> str:  # noqa: ANN001 - SQLAlchemy statement
    return str(stmt.compile(compile_kwargs={"literal_binds": True})).lower()


async def test_reviewers_query_unions_manager_and_team_leads_over_active_membership() -> None:
    execute, captured = _capturing_session([(MANAGER,), (LEAD,)])
    session = MagicMock()
    session.execute = execute

    reviewers = await TimeAccess(session).reviewers_of(ORG, SUBJECT)

    assert reviewers == {MANAGER, LEAD}
    assert len(captured) == 1
    sql = _compiled(captured[0])
    assert "people_profiles" in sql
    assert "login_groups" in sql
    assert "login_group_members" in sql
    assert "'team'" in sql
    assert "login_organization_members" in sql
    assert "login_users" in sql
    assert sql.count("is_active is true") >= 3
    assert ORG.hex in sql
    assert f"user_id != '{SUBJECT.hex}'" in sql


async def test_named_reviewers_are_the_only_reviewers() -> None:
    access = TimeAccess(MagicMock())
    access.reviewers_of = AsyncMock(return_value={MANAGER})
    access.is_timekeeping_admin = AsyncMock(return_value=True)

    assert await access.is_reviewer_of(MANAGER, ORG, SUBJECT)
    # An admin is not a reviewer while somebody is named; the fallback is for empty sets only.
    assert not await access.is_reviewer_of(STRANGER, ORG, SUBJECT)
    access.is_timekeeping_admin.assert_not_awaited()


async def test_timekeeping_admins_review_when_nobody_is_named() -> None:
    access = TimeAccess(MagicMock())
    access.reviewers_of = AsyncMock(return_value=set())
    access.is_timekeeping_admin = AsyncMock(return_value=True)
    assert await access.is_reviewer_of(STRANGER, ORG, SUBJECT)

    access.is_timekeeping_admin = AsyncMock(return_value=False)
    assert not await access.is_reviewer_of(STRANGER, ORG, SUBJECT)


async def test_person_scope_admits_self_and_named_reviewers_only() -> None:
    access = TimeAccess(MagicMock())
    access.require_active_actor = AsyncMock()
    access.reviewers_of = AsyncMock(return_value={MANAGER})
    access.is_timekeeping_admin = AsyncMock(return_value=True)

    await access.require_person_scope(SUBJECT, ORG, SUBJECT)
    await access.require_person_scope(MANAGER, ORG, SUBJECT)
    # An admin reads a person's week only when nobody else reviews that person.
    with pytest.raises(PermissionDeniedError):
        await access.require_person_scope(STRANGER, ORG, SUBJECT)

    access.reviewers_of = AsyncMock(return_value=set())
    await access.require_person_scope(STRANGER, ORG, SUBJECT)


async def test_person_scope_stops_a_deactivated_actor_even_on_the_self_path() -> None:
    access = TimeAccess(MagicMock())
    access.require_active_actor = AsyncMock(side_effect=PermissionDeniedError("inactive"))
    with pytest.raises(PermissionDeniedError):
        await access.require_person_scope(SUBJECT, ORG, SUBJECT)


async def test_timekeeping_admin_is_org_admin_or_projects_domain_admin() -> None:
    org_ops = MagicMock()
    org_ops.require_org_admin = AsyncMock(side_effect=PermissionDeniedError("admin"))
    with (
        patch("uniffy.domains.projects.time.access.OrganizationOperations", return_value=org_ops),
        patch(
            "uniffy.domains.projects.time.access.is_domain_admin", new=AsyncMock(return_value=False)
        ) as domain_admin,
    ):
        access = TimeAccess(MagicMock())
        assert not await access.is_timekeeping_admin(STRANGER, ORG)
        assert domain_admin.await_args.args[3].value == "PROJECTS"

        domain_admin.return_value = True
        assert await access.is_timekeeping_admin(STRANGER, ORG)

        org_ops.require_org_admin = AsyncMock(return_value=MagicMock())
        domain_admin.return_value = False
        assert await access.is_timekeeping_admin(STRANGER, ORG)
