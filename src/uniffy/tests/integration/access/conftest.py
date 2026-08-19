"""One org with real content, for the access guards that used to be asserted
by grepping compiled SQL.

Every test here answers the only question that matters for an access filter:
which rows come back. That cannot be established from the text of a query, so
these run against the real engine through `open_session`, with content rows
created the way the domains create them.

``init_db`` binds a pooled engine to the event loop that created it, so every
fixture and test in this suite shares one session-scoped loop. The schema is
expected to be at head already; the dev stack migrates on boot.
"""

from types import SimpleNamespace as NS

import pytest
import pytest_asyncio
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.chat.agent_folder import ChatAgentFolder
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.comments.comment import Comment
from uniffy.core.models.comments.comment_reaction import CommentReaction
from uniffy.core.models.login.group import Group, GroupKind
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.notes.note import Note
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.permissions.content_access_request import ContentAccessRequest
from uniffy.core.models.permissions.domain_admin import DomainAdmin
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.models.platform.support_session import SupportSession
from uniffy.core.models.tags.tag import Tag
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType, generate_id
from uniffy.core.valkey.ops import close_ops_client, init_ops_client
from uniffy.db import close_db, init_db, open_session
from uniffy.db.session import get_database_url


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


@pytest_asyncio.fixture(scope="session", loop_scope="session", autouse=True)
async def valkey_backend():
    try:
        await init_ops_client()
    except Exception:
        yield
    else:
        try:
            yield
        finally:
            await close_ops_client()


@pytest_asyncio.fixture(loop_scope="session")
async def session(database):
    async with open_session() as db_session:
        yield db_session


def _note(org_id, owner_id, title, *, access_mode, baseline_role=None) -> Note:
    return Note(
        organization_id=org_id,
        owner_id=owner_id,
        title=title,
        slug=f"{title.lower().replace(' ', '-')}-{generate_id().hex[:8]}",
        access_mode=access_mode,
        baseline_role=baseline_role,
    )


async def _seed_access(db_session: AsyncSession) -> NS:
    """An org with an admin who owns nothing, and a member who owns private
    content - the exact shape an admin bypass would leak.
    """
    suffix = generate_id().hex[:12]

    def _user(handle: str) -> User:
        return User(
            email=f"ita-{handle}-{suffix}@test.local",
            username=f"ita-{handle}-{suffix}",
            full_name=f"{handle.title()} Tester",
            hashed_password="x",
        )

    owner = _user("owner")
    admin = _user("admin")
    member = _user("member")
    peer = _user("peer")
    ghost = _user("ghost")
    outsider = _user("outsider")

    org = Organization(name=f"ita {suffix}", slug=f"ita-{suffix}")
    other_org = Organization(name=f"ita other {suffix}", slug=f"ita-other-{suffix}")
    db_session.add_all([owner, admin, member, peer, ghost, outsider, org, other_org])
    await db_session.flush()

    db_session.add_all([
        OrganizationMember(user_id=owner.id, organization_id=org.id, role=OrganizationRole.OWNER),
        OrganizationMember(user_id=admin.id, organization_id=org.id, role=OrganizationRole.ADMIN),
        OrganizationMember(user_id=member.id, organization_id=org.id, role=OrganizationRole.MEMBER),
        OrganizationMember(user_id=peer.id, organization_id=org.id, role=OrganizationRole.MEMBER),
        OrganizationMember(
            user_id=ghost.id,
            organization_id=org.id,
            role=OrganizationRole.MEMBER,
            is_active=False,
        ),
        OrganizationMember(
            user_id=outsider.id,
            organization_id=other_org.id,
            role=OrganizationRole.OWNER,
        ),
    ])

    private_note = _note(org.id, member.id, "Member private", access_mode=AccessMode.OWNER_ONLY)
    shared_note = _note(org.id, member.id, "Member shared", access_mode=AccessMode.EXPLICIT_MEMBERS)
    org_note = _note(
        org.id,
        member.id,
        "Member org wide",
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.VIEWER,
    )
    blocked_note = _note(
        org.id,
        member.id,
        "Member blocks peer",
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.VIEWER,
    )
    admin_note = _note(org.id, admin.id, "Admin own", access_mode=AccessMode.OWNER_ONLY)
    group_note = _note(
        org.id, member.id, "Member group shared", access_mode=AccessMode.EXPLICIT_MEMBERS
    )
    db_session.add_all([private_note, shared_note, org_note, blocked_note, admin_note, group_note])

    access_group = Group(
        organization_id=org.id,
        name=f"Readers {suffix}",
        slug=f"readers-{suffix}",
        kind=GroupKind.ACCESS,
        created_by_user_id=owner.id,
    )
    private_group = Group(
        organization_id=org.id,
        name=f"Secret {suffix}",
        slug=f"secret-{suffix}",
        kind=GroupKind.ACCESS,
        is_private=True,
        created_by_user_id=owner.id,
    )
    team = Group(
        organization_id=org.id,
        name=f"Platform {suffix}",
        slug=f"platform-{suffix}",
        kind=GroupKind.TEAM,
        lead_user_id=member.id,
        created_by_user_id=owner.id,
    )
    db_session.add_all([access_group, private_group, team])
    await db_session.flush()

    db_session.add_all([
        GroupMember(group_id=access_group.id, user_id=peer.id),
        GroupMember(group_id=private_group.id, user_id=member.id),
        GroupMember(group_id=team.id, user_id=member.id),
        GroupMember(group_id=team.id, user_id=ghost.id),
        # An inactive row confers nothing anywhere.
        GroupMember(group_id=team.id, user_id=peer.id, is_active=False),
    ])

    db_session.add_all([
        ContentMember(
            organization_id=org.id,
            content_type=ContentType.NOTE,
            content_id=shared_note.id,
            subject_type=SubjectType.USER,
            subject_id=peer.id,
            role=ContentRole.VIEWER,
            added_by_user_id=member.id,
        ),
        ContentMember(
            organization_id=org.id,
            content_type=ContentType.NOTE,
            content_id=group_note.id,
            subject_type=SubjectType.GROUP,
            subject_id=access_group.id,
            role=ContentRole.EDITOR,
            added_by_user_id=member.id,
        ),
        ContentMember(
            organization_id=org.id,
            content_type=ContentType.NOTE,
            content_id=blocked_note.id,
            subject_type=SubjectType.USER,
            subject_id=peer.id,
            role=ContentRole.BLOCKED,
            added_by_user_id=member.id,
        ),
    ])
    await db_session.commit()

    return NS(
        org_id=org.id,
        other_org_id=other_org.id,
        owner_id=owner.id,
        admin_id=admin.id,
        member_id=member.id,
        peer_id=peer.id,
        ghost_id=ghost.id,
        outsider_id=outsider.id,
        private_note_id=private_note.id,
        shared_note_id=shared_note.id,
        org_note_id=org_note.id,
        blocked_note_id=blocked_note.id,
        admin_note_id=admin_note.id,
        group_note_id=group_note.id,
        access_group_id=access_group.id,
        private_group_id=private_group.id,
        team_id=team.id,
        group_ids=[access_group.id, private_group.id, team.id],
        user_ids=[owner.id, admin.id, member.id, peer.id, ghost.id, outsider.id],
        org_ids=[org.id, other_org.id],
    )


async def _teardown_access(db_session: AsyncSession, env: NS) -> None:
    await db_session.rollback()
    comment_ids = (
        await db_session.execute(
            select(Comment.id).where(Comment.organization_id.in_(env.org_ids))
        )
    ).scalars()
    await db_session.execute(delete(CommentReaction).where(CommentReaction.comment_id.in_(comment_ids)))
    await db_session.execute(delete(Comment).where(Comment.organization_id.in_(env.org_ids)))
    await db_session.execute(
        delete(SupportSession).where(SupportSession.organization_id.in_(env.org_ids))
    )
    await db_session.execute(
        delete(ChatAgentFolder).where(ChatAgentFolder.organization_id.in_(env.org_ids))
    )
    await db_session.execute(delete(Tag).where(Tag.organization_id.in_(env.org_ids)))
    # Tests grant domain-admin rows and open channels; both hold FKs on the org.
    channel_ids = (
        (
            await db_session.execute(
                select(ChatChannel.id).where(ChatChannel.organization_id.in_(env.org_ids))
            )
        )
        .scalars()
        .all()
    )
    if channel_ids:
        await db_session.execute(
            delete(ChatChannelMember).where(ChatChannelMember.channel_id.in_(channel_ids))
        )
        await db_session.execute(delete(ChatChannel).where(ChatChannel.id.in_(channel_ids)))
    await db_session.execute(delete(DomainAdmin).where(DomainAdmin.organization_id.in_(env.org_ids)))
    await db_session.execute(
        delete(ContentMember).where(ContentMember.organization_id.in_(env.org_ids))
    )
    await db_session.execute(
        delete(ContentAccessRequest).where(
            ContentAccessRequest.organization_id.in_(env.org_ids)
        )
    )
    await db_session.execute(delete(Note).where(Note.organization_id.in_(env.org_ids)))
    await db_session.execute(delete(Task).where(Task.organization_id.in_(env.org_ids)))
    await db_session.execute(delete(Project).where(Project.organization_id.in_(env.org_ids)))
    event_ids = (
        (
            await db_session.execute(
                select(CalendarEvent.id).where(CalendarEvent.organization_id.in_(env.org_ids))
            )
        )
        .scalars()
        .all()
    )
    if event_ids:
        await db_session.execute(delete(EventAttendee).where(EventAttendee.event_id.in_(event_ids)))
        await db_session.execute(delete(CalendarEvent).where(CalendarEvent.id.in_(event_ids)))
    await db_session.execute(delete(Calendar).where(Calendar.organization_id.in_(env.org_ids)))
    await db_session.execute(delete(GroupMember).where(GroupMember.group_id.in_(env.group_ids)))
    await db_session.execute(delete(Group).where(Group.organization_id.in_(env.org_ids)))
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
async def access(session):
    seeded = await _seed_access(session)
    try:
        yield seeded
    finally:
        await _teardown_access(session, seeded)
