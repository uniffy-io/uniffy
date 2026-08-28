"""Fixtures backed by the application's own database layer.

These tests exist to catch what a mock cannot: a unique constraint, an
envelope-encrypted column, a gate that must fire before a row load. That only
holds if the machinery underneath is the machinery the request path uses, so
the engine and the sessions here come from ``init_db`` and ``open_session``
rather than from an engine built for tests.

``init_db`` binds a pooled engine to the event loop that created it, which is
why every fixture and test in this suite shares one session-scoped loop.

The schema is expected to be at head already; the dev stack migrates on boot.
"""

from types import SimpleNamespace as NS

import pytest
import pytest_asyncio
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.crypto import OrgCipher
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.crypto.org_encryption_key import OrgEncryptionKey
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.integrations.connection import IntegrationConnection
from uniffy.core.models.login.group import Group
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.rooms.booking import RoomBooking
from uniffy.core.models.rooms.room import Room
from uniffy.core.types import generate_id
from uniffy.db import close_db, init_db, open_session
from uniffy.db.session import get_database_url
from uniffy.domains.notes.registration import register_note_content


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def database():
    """Bring up the real engine once, or skip the suite when nothing answers."""
    register_note_content()
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


async def seed_env(db_session: AsyncSession) -> NS:
    """One org with an admin, a member, and a provisioned DEK."""
    suffix = generate_id().hex[:12]
    admin = User(
        email=f"itdb-admin-{suffix}@test.local",
        username=f"itdb-admin-{suffix}",
        hashed_password="x",
    )
    member = User(
        email=f"itdb-member-{suffix}@test.local",
        username=f"itdb-member-{suffix}",
        hashed_password="x",
    )
    org = Organization(name=f"itdb {suffix}", slug=f"itdb-{suffix}")
    db_session.add_all([admin, member, org])
    await db_session.flush()
    db_session.add_all([
        OrganizationMember(user_id=admin.id, organization_id=org.id, role=OrganizationRole.ADMIN),
        OrganizationMember(user_id=member.id, organization_id=org.id, role=OrganizationRole.MEMBER),
    ])
    await OrgCipher(db_session).provision(org.id, admin.id)
    await db_session.commit()
    return NS(org_id=org.id, admin_id=admin.id, member_id=member.id)


async def teardown_env(db_session: AsyncSession, env: NS) -> None:
    await db_session.rollback()
    await db_session.execute(delete(Agent).where(Agent.organization_id == env.org_id))
    await db_session.execute(
        delete(IntegrationConnection).where(IntegrationConnection.organization_id == env.org_id)
    )
    await db_session.execute(
        delete(ContentMember).where(ContentMember.organization_id == env.org_id)
    )
    await db_session.execute(delete(RoomBooking).where(RoomBooking.organization_id == env.org_id))
    await db_session.execute(delete(Room).where(Room.organization_id == env.org_id))
    await db_session.execute(delete(Folder).where(Folder.organization_id == env.org_id))
    group_ids = list(
        (
            await db_session.execute(select(Group.id).where(Group.organization_id == env.org_id))
        ).scalars()
    )
    if group_ids:
        await db_session.execute(delete(GroupMember).where(GroupMember.group_id.in_(group_ids)))
        await db_session.execute(delete(Group).where(Group.id.in_(group_ids)))
    # audit_events is append-only; teardown is maintenance, so it opts out.
    await db_session.execute(text("SET LOCAL uniffy.audit_maintenance = 'on'"))
    await db_session.execute(delete(AuditEvent).where(AuditEvent.organization_id == env.org_id))
    await db_session.execute(
        delete(OrgEncryptionKey).where(OrgEncryptionKey.organization_id == env.org_id)
    )
    await db_session.execute(
        delete(OrganizationMember).where(OrganizationMember.organization_id == env.org_id)
    )
    await db_session.execute(delete(Organization).where(Organization.id == env.org_id))
    await db_session.execute(delete(User).where(User.id.in_([env.admin_id, env.member_id])))
    await db_session.commit()


@pytest_asyncio.fixture(loop_scope="session")
async def env(session):
    seeded = await seed_env(session)
    try:
        yield seeded
    finally:
        await teardown_env(session, seeded)


@pytest_asyncio.fixture(loop_scope="session")
async def second_env(session):
    """A second, unrelated org, for the cases that assert tenant isolation."""
    seeded = await seed_env(session)
    try:
        yield seeded
    finally:
        await teardown_env(session, seeded)
