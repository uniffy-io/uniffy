"""A real org to read the people surface against.

The directory, the chart and the team rollups are queries: which rows come
back, in what order, and which are excluded. Mocking the session would assert
on SQLAlchemy's rendering instead of on that, so this suite seeds real rows
through the application's own engine and asserts on results.

``init_db`` binds a pooled engine to the event loop that created it, so every
fixture and test here shares one session-scoped loop. The schema is expected to
be at head already; the dev stack migrates on boot.
"""

from types import SimpleNamespace as NS

import pytest
import pytest_asyncio
from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.login.group import Group, GroupKind
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.people.profile import PeopleProfile
from uniffy.core.types import generate_id
from uniffy.infrastructure.database import close_db, init_db, open_session
from uniffy.infrastructure.database.session import get_database_url


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def database():
    """Bring up the real engine once, or skip the suite when nothing answers."""
    try:
        await init_db(skip_migrations=True)
    except Exception as exc:
        pytest.skip(f"no database at {get_database_url()}: {exc}")
    try:
        yield
    finally:
        await close_db()


@pytest_asyncio.fixture(loop_scope="session")
async def session(database):
    async with open_session() as db_session:
        yield db_session


async def _seed_people(db_session: AsyncSession) -> NS:
    """An org shaped like a small company.

    ceo -> vp -> (ic, contractor); lead runs the Platform team; ghost is a
    deactivated member; stranger belongs to a second org entirely.
    """
    suffix = generate_id().hex[:12]

    def _user(handle: str, full_name: str) -> User:
        return User(
            email=f"itp-{handle}-{suffix}@test.local",
            username=f"itp-{handle}-{suffix}",
            full_name=full_name,
            hashed_password="x",
        )

    ceo = _user("ceo", "Ada Chief")
    vp = _user("vp", "Boris Vice")
    ic = _user("ic", "Clara Engineer")
    contractor = _user("contractor", "Dora Contract")
    lead = _user("lead", "Emil Lead")
    ghost = _user("ghost", "Frank Gone")
    stranger = _user("stranger", "Greta Elsewhere")

    org = Organization(name=f"itp {suffix}", slug=f"itp-{suffix}")
    other_org = Organization(name=f"itp other {suffix}", slug=f"itp-other-{suffix}")
    db_session.add_all([ceo, vp, ic, contractor, lead, ghost, stranger, org, other_org])
    await db_session.flush()

    db_session.add_all([
        OrganizationMember(user_id=ceo.id, organization_id=org.id, role=OrganizationRole.OWNER),
        OrganizationMember(user_id=vp.id, organization_id=org.id, role=OrganizationRole.ADMIN),
        OrganizationMember(user_id=ic.id, organization_id=org.id, role=OrganizationRole.MEMBER),
        OrganizationMember(
            user_id=contractor.id, organization_id=org.id, role=OrganizationRole.MEMBER
        ),
        OrganizationMember(user_id=lead.id, organization_id=org.id, role=OrganizationRole.MEMBER),
        OrganizationMember(
            user_id=ghost.id,
            organization_id=org.id,
            role=OrganizationRole.MEMBER,
            is_active=False,
        ),
        OrganizationMember(
            user_id=stranger.id,
            organization_id=other_org.id,
            role=OrganizationRole.OWNER,
        ),
    ])

    db_session.add_all([
        PeopleProfile(
            organization_id=org.id,
            user_id=ceo.id,
            job_title="Chief Executive",
            department="Leadership",
        ),
        PeopleProfile(
            organization_id=org.id,
            user_id=vp.id,
            job_title="VP Engineering",
            department="Engineering",
            manager_user_id=ceo.id,
        ),
        PeopleProfile(
            organization_id=org.id,
            user_id=ic.id,
            job_title="Backend Engineer",
            department="Engineering",
            manager_user_id=vp.id,
        ),
        PeopleProfile(
            organization_id=org.id,
            user_id=contractor.id,
            job_title="Consultant",
            department="Engineering",
            manager_user_id=vp.id,
            managed_fields=["job_title", "department"],
        ),
        PeopleProfile(
            organization_id=org.id,
            user_id=ghost.id,
            job_title="Former Analyst",
            department="Finance",
            manager_user_id=ceo.id,
        ),
    ])

    platform = Group(
        organization_id=org.id,
        name=f"Platform {suffix}",
        slug=f"platform-{suffix}",
        kind=GroupKind.TEAM,
        lead_user_id=lead.id,
        created_by_user_id=ceo.id,
    )
    infra = Group(
        organization_id=org.id,
        name=f"Infrastructure {suffix}",
        slug=f"infra-{suffix}",
        kind=GroupKind.TEAM,
        created_by_user_id=ceo.id,
    )
    access_group = Group(
        organization_id=org.id,
        name=f"Billing readers {suffix}",
        slug=f"billing-{suffix}",
        kind=GroupKind.ACCESS,
        created_by_user_id=ceo.id,
    )
    db_session.add_all([platform, infra, access_group])
    await db_session.flush()
    infra.parent_group_id = platform.id

    db_session.add_all([
        GroupMember(group_id=platform.id, user_id=lead.id),
        GroupMember(group_id=platform.id, user_id=ic.id),
        # An inactive membership confers nothing on any people surface.
        GroupMember(group_id=platform.id, user_id=contractor.id, is_active=False),
        # A deactivated member holding a live team row must still not list.
        GroupMember(group_id=platform.id, user_id=ghost.id),
        GroupMember(group_id=access_group.id, user_id=ic.id),
    ])
    await db_session.commit()

    return NS(
        org_id=org.id,
        other_org_id=other_org.id,
        ceo_id=ceo.id,
        vp_id=vp.id,
        ic_id=ic.id,
        contractor_id=contractor.id,
        lead_id=lead.id,
        ghost_id=ghost.id,
        stranger_id=stranger.id,
        platform_id=platform.id,
        infra_id=infra.id,
        access_group_id=access_group.id,
        user_ids=[ceo.id, vp.id, ic.id, contractor.id, lead.id, ghost.id, stranger.id],
        org_ids=[org.id, other_org.id],
    )


async def _teardown_people(db_session: AsyncSession, env: NS) -> None:
    await db_session.rollback()
    await db_session.execute(
        delete(GroupMember).where(
            GroupMember.group_id.in_([env.platform_id, env.infra_id, env.access_group_id])
        )
    )
    # The self-referencing parent edge is ON DELETE SET NULL, so one statement
    # clears the whole tree.
    await db_session.execute(delete(Group).where(Group.organization_id.in_(env.org_ids)))
    await db_session.execute(
        delete(PeopleProfile).where(PeopleProfile.organization_id.in_(env.org_ids))
    )
    # audit_events is append-only; teardown is maintenance, so it opts out.
    await db_session.execute(text("SET LOCAL uniffy.audit_maintenance = 'on'"))
    await db_session.execute(delete(AuditEvent).where(AuditEvent.organization_id.in_(env.org_ids)))
    await db_session.execute(
        delete(OrganizationMember).where(OrganizationMember.organization_id.in_(env.org_ids))
    )
    await db_session.execute(delete(Organization).where(Organization.id.in_(env.org_ids)))
    await db_session.execute(delete(User).where(User.id.in_(env.user_ids)))
    await db_session.commit()


@pytest_asyncio.fixture(loop_scope="session")
async def people(session):
    seeded = await _seed_people(session)
    try:
        yield seeded
    finally:
        await _teardown_people(session, seeded)
