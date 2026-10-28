"""Batched reviewer mappings preserve the live directory permission gates."""

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.login.group import Group, GroupKind
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.people.profile import PeopleProfile
from uniffy.core.models.permissions.domain_admin import DomainAdmin
from uniffy.core.types import DomainType, generate_id
from uniffy.domains.projects.time.access import TimeAccess
from uniffy.domains.projects.time.policy import ResolvedTimePolicy
from uniffy.domains.projects.time.reminders import _auto_submit
from uniffy.infrastructure.database import open_session

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest_asyncio.fixture(loop_scope="session")
async def reviewers(session: AsyncSession) -> AsyncIterator[SimpleNamespace]:
    suffix = generate_id().hex
    names = (
        "worker",
        "unassigned",
        "manager",
        "lead",
        "owner",
        "admin",
        "domain",
        "inactive",
        "outsider",
    )
    users = {
        name: User(
            email=f"time-{name}-{suffix}@test.local",
            username=f"{name}-{suffix}",
            hashed_password="x",
        )
        for name in names
    }
    org = Organization(name=f"Reviewers {suffix}", slug=f"reviewers-{suffix}")
    other = Organization(name=f"Other {suffix}", slug=f"other-{suffix}")
    session.add_all([org, other, *users.values()])
    await session.flush()
    for name, user in users.items():
        role = {"owner": OrganizationRole.OWNER, "admin": OrganizationRole.ADMIN}.get(
            name, OrganizationRole.MEMBER
        )
        session.add(
            OrganizationMember(
                organization_id=other.id if name == "outsider" else org.id,
                user_id=user.id,
                role=role,
                is_active=name != "inactive",
            )
        )
    session.add_all([
        DomainAdmin(
            organization_id=org.id,
            user_id=users[name].id,
            domain=DomainType.PROJECTS,
            granted_by=users["owner"].id,
        )
        for name in ("domain", "inactive", "outsider")
    ])
    session.add_all([
        PeopleProfile(
            organization_id=org.id, user_id=users["worker"].id, manager_user_id=users["manager"].id
        ),
        PeopleProfile(
            organization_id=other.id,
            user_id=users["unassigned"].id,
            manager_user_id=users["outsider"].id,
        ),
    ])
    for name, kind, lead, active, organization_id in (
        ("team", GroupKind.TEAM, "lead", True, org.id),
        ("duplicate", GroupKind.TEAM, "manager", True, org.id),
        ("self", GroupKind.TEAM, "worker", True, org.id),
        ("inactive-lead", GroupKind.TEAM, "inactive", True, org.id),
        ("inactive-membership", GroupKind.TEAM, "owner", False, org.id),
        ("access", GroupKind.ACCESS, "admin", True, org.id),
        ("foreign-team", GroupKind.TEAM, "outsider", True, other.id),
        ("nonmember-lead", GroupKind.TEAM, "outsider", True, org.id),
    ):
        group = Group(
            organization_id=organization_id,
            name=name,
            slug=name,
            kind=kind,
            lead_user_id=users[lead].id,
            created_by_user_id=users["owner"].id,
        )
        session.add(group)
        await session.flush()
        session.add(GroupMember(group_id=group.id, user_id=users["worker"].id, is_active=active))
    await session.flush()
    try:
        yield SimpleNamespace(org=org.id, users={name: user.id for name, user in users.items()})
    finally:
        await session.rollback()


async def test_batch_matches_single_person_gates_and_reads_admins_once(
    session: AsyncSession, reviewers: SimpleNamespace
) -> None:
    ids = reviewers.users
    access = TimeAccess(session)
    subjects = [ids["worker"], ids["unassigned"], ids["owner"]]
    with patch.object(session, "execute", new=AsyncMock(wraps=session.execute)) as execute:
        result = await access.batch_review_recipients(reviewers.org, subjects)
    assert execute.await_count == 2
    admins = {ids["owner"], ids["admin"], ids["domain"]}
    assert result == {
        ids["worker"]: {ids["manager"], ids["lead"]},
        ids["unassigned"]: admins,
        ids["owner"]: admins - {ids["owner"]},
    }
    assert result == {
        subject: await access.review_recipients(reviewers.org, subject) for subject in subjects
    }


async def test_batch_reloads_global_and_org_deactivation_before_admin_fallback(
    session: AsyncSession, reviewers: SimpleNamespace
) -> None:
    ids = reviewers.users
    access = TimeAccess(session)
    assert (await access.batch_review_recipients(reviewers.org, [ids["worker"]]))[ids["worker"]] == {
        ids["manager"],
        ids["lead"],
    }
    await session.execute(update(User).where(User.id == ids["manager"]).values(is_active=False))
    await session.execute(
        update(OrganizationMember)
        .where(
            OrganizationMember.organization_id == reviewers.org,
            OrganizationMember.user_id == ids["lead"],
        )
        .values(is_active=False)
    )
    await session.execute(update(User).where(User.id == ids["domain"]).values(is_active=False))
    assert await access.batch_review_recipients(reviewers.org, [ids["worker"]]) == {
        ids["worker"]: {ids["owner"], ids["admin"]}
    }


async def test_empty_auto_submit_releases_person_and_organization_locks(database) -> None:  # noqa: ANN001
    org, person = generate_id(), generate_id()
    policy = ResolvedTimePolicy(
        organization_id=org, approvals_enabled=True, auto_submit=True, period_lock_delay_days=30
    )
    async with open_session() as scheduler:
        with patch(
            "uniffy.domains.projects.time.reminders._members_with_entries",
            new=AsyncMock(return_value={person}),
        ):
            assert (
                await _auto_submit(scheduler, org, policy, datetime(2026, 10, 21, 9, tzinfo=UTC))
                == 0
            )
        async with open_session() as writer:
            for key in (f"time:org:{org}", f"time:person:{org}:{person}"):
                assert (
                    await writer.scalar(
                        select(func.pg_try_advisory_xact_lock(func.hashtextextended(key, 0)))
                    )
                    is True
                )
