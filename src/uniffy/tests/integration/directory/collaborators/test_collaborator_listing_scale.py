"""The picker's first page stays fast in a 5,000-member organization."""

import statistics
import time
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace as NS

import pytest
import pytest_asyncio
from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.login.group import Group, GroupKind
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.people.collaborator_score import CollaboratorScore
from uniffy.core.types import generate_id
from uniffy.domains.directory.collaborators.reader import CollaboratorReader, CollaboratorTier
from uniffy.domains.directory.collaborators.signals import MAX_ROWS_PER_VIEWER
from uniffy.infrastructure.database import open_session

pytestmark = pytest.mark.asyncio(loop_scope="session")

MEMBERS = 5_000
ROUNDS = 60
P95_BUDGET_MS = 100.0
_FIRST_NAMES = ("Maria", "Ivan", "Anna", "Georgi", "Elena", "Petar", "Sofia", "Nikolay")


async def _seed(session: AsyncSession) -> NS:
    suffix = generate_id().hex[-10:]
    org = Organization(name=f"scale {suffix}", slug=f"scale-{suffix}")
    session.add(org)
    await session.flush()
    users = [
        User(
            email=f"scale-{i}-{suffix}@test.local",
            username=f"scale-{i}-{suffix}",
            full_name=f"{_FIRST_NAMES[i % len(_FIRST_NAMES)]} Member{i:05d}",
            hashed_password="x",
        )
        for i in range(MEMBERS)
    ]
    for start in range(0, MEMBERS, 1_000):
        session.add_all(users[start : start + 1_000])
        await session.flush()
    user_ids = [user.id for user in users]
    for start in range(0, MEMBERS, 1_000):
        session.add_all([
            OrganizationMember(user_id=uid, organization_id=org.id, role=OrganizationRole.MEMBER)
            for uid in user_ids[start : start + 1_000]
        ])
        await session.flush()
    viewer = user_ids[0]
    team = Group(
        organization_id=org.id,
        name=f"Team {suffix}",
        slug=f"team-{suffix}",
        kind=GroupKind.TEAM,
        created_by_user_id=viewer,
    )
    session.add(team)
    await session.flush()
    session.add_all([GroupMember(group_id=team.id, user_id=uid) for uid in user_ids[:12]])
    now = datetime.now(UTC)
    await session.execute(
        pg_insert(CollaboratorScore).values([
            {
                "organization_id": org.id,
                "user_id": viewer,
                "peer_id": peer,
                "score": float(1 + i % 17),
                "scored_at": now - timedelta(hours=i),
                "last_interaction_at": now - timedelta(hours=i),
            }
            for i, peer in enumerate(user_ids[1 : MAX_ROWS_PER_VIEWER + 1])
        ])
    )
    seeded = NS(org_id=org.id, team_id=team.id, viewer=viewer, user_ids=user_ids)
    await session.commit()
    return seeded


@pytest_asyncio.fixture(scope="module", loop_scope="session")
async def large_org(database):
    async with open_session() as session:
        seeded = await _seed(session)
        try:
            yield seeded
        finally:
            await session.rollback()
            await session.execute(delete(GroupMember).where(GroupMember.group_id == seeded.team_id))
            await session.execute(delete(Group).where(Group.id == seeded.team_id))
            await session.execute(
                delete(OrganizationMember).where(OrganizationMember.organization_id == seeded.org_id)
            )
            await session.execute(delete(Organization).where(Organization.id == seeded.org_id))
            await session.commit()
            # Every table referencing users is checked per row, so a single delete times out.
            for start in range(0, MEMBERS, 250):
                await session.execute(
                    delete(User).where(User.id.in_(seeded.user_ids[start : start + 250]))
                )
                await session.commit()


@pytest.mark.parametrize("query", ["", "m", "ma", "member0421"])
async def test_first_page_is_under_budget(session, large_org, query):
    reader = CollaboratorReader(session)
    rows = await reader.list(large_org.org_id, large_org.viewer, query=query)
    timings = []
    for _ in range(ROUNDS):
        started = time.perf_counter()
        await reader.list(large_org.org_id, large_org.viewer, query=query)
        timings.append((time.perf_counter() - started) * 1_000)
    p95 = statistics.quantiles(timings, n=20)[18]
    print(f"query={query!r} p95={p95:.1f}ms rows={len(rows)}")
    assert rows
    if not query:
        assert rows[0].tier is CollaboratorTier.COLLABORATOR
    assert p95 < P95_BUDGET_MS
