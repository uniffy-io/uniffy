"""One org with real content on the live PostgreSQL and Valkey, shared by the access suites.

Access filters are asserted on the rows they return. ``init_db`` binds its pooled engine to the
loop that created it, so every fixture and test here shares one session-scoped loop; the schema
is expected at head because the dev stack migrates on boot.
"""

import os
from collections.abc import AsyncIterator, Sequence
from types import SimpleNamespace as NS
from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import delete, or_, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.jobs.types import QueueName
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.bookmarks.bookmark import Bookmark
from uniffy.core.models.calendar.activity import EventActivity
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.reminder import EventReminder
from uniffy.core.models.calendar.template import EventTemplate
from uniffy.core.models.chat.agent_folder import ChatAgentFolder
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.comments.comment import Comment
from uniffy.core.models.comments.comment_reaction import CommentReaction
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.files.storage_usage import StorageUsage
from uniffy.core.models.login.group import Group, GroupKind
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.notes.note import Note
from uniffy.core.models.notifications.notification import Notification
from uniffy.core.models.permissions.content_access_request import ContentAccessRequest
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.permissions.domain_admin import DomainAdmin
from uniffy.core.models.permissions.org_permission_defaults import OrganizationPermissionDefaults
from uniffy.core.models.platform.support_session import SupportSession
from uniffy.core.models.projects.field_definition import FieldDefinition
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.search_acl_refresh import ProjectSearchAclRefresh
from uniffy.core.models.projects.sprint import Sprint
from uniffy.core.models.projects.task import Task
from uniffy.core.models.projects.view_config import ViewConfig
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.models.tags.tag import Tag
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.storage import lock_documents
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType, generate_id
from uniffy.domains.files.registration import register_file_content
from uniffy.domains.notes.registration import register_note_content
from uniffy.domains.projects.registration import register_project_content
from uniffy.domains.scheduling.calendar.realtime import register_event_realtime_adapter
from uniffy.infrastructure.database import close_db, init_db, open_session
from uniffy.infrastructure.database.session import get_database_url
from uniffy.infrastructure.valkey.binary import (
    close_binary_client,
    get_binary_client,
    init_binary_client,
)
from uniffy.infrastructure.valkey.ops import close_ops_client, init_ops_client
from uniffy.infrastructure.valkey.queue import close_queue, init_queue
from uniffy.tests.integration.access.realtime_documents import (
    LIVE_TYPES,
    SharedDocument,
    create_document,
    discard,
)
from uniffy.tests.integration.access.realtime_live import BUDGET
from uniffy.tests.integration.access.recording_search import recording_indexer
from uniffy.vendor.arq.constants import job_key_prefix

# No worker consumes queues in this logical database.
UNREAD_QUEUE_DATABASE = 15
# The dev stack's workers act on the shared database while a suite runs: a deadlock with one of
# them, or a row one added after its table was cleared, aborts only that teardown attempt.
_RACED_BY_WORKERS = {"40P01", "23503"}
_TEARDOWN_ATTEMPTS = 3


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def database():
    """Bring up the real engine once, or skip the suite when nothing answers."""
    register_file_content()
    register_note_content()
    register_project_content()
    register_event_realtime_adapter(recording_indexer())
    try:
        await init_db(skip_migrations=True)
    except Exception as exc:
        if os.getenv("REQUIRE_DATABASE_TESTS"):
            raise
        pytest.skip(f"no database at {get_database_url()}: {exc}")
    try:
        yield
    finally:
        await close_db()


@pytest_asyncio.fixture(scope="session", loop_scope="session", autouse=True)
async def valkey_backend():
    """Bring up the Valkey clients, or run without them unless Valkey is required."""
    try:
        await init_ops_client()
        await init_binary_client()
    except Exception:
        if os.getenv("REQUIRE_VALKEY_TESTS"):
            raise
    try:
        yield
    finally:
        await close_binary_client()
        await close_ops_client()


@pytest_asyncio.fixture(scope="session", loop_scope="session", autouse=True)
async def unread_job_queues(valkey_backend) -> AsyncIterator[None]:
    """Queue pools open on a Valkey database no worker reads, so test jobs never reach a worker."""
    for name in QueueName:
        await close_queue(name)
    if get_binary_client() is None:
        yield
        return
    with pytest.MonkeyPatch.context() as env:
        env.setenv("VALKEY_DATABASE", str(UNREAD_QUEUE_DATABASE))
        pools = {name: await init_queue(name) for name in QueueName}
    try:
        yield
    finally:
        for name, pool in pools.items():
            stranded = await pool.zrange(name.valkey_name, 0, -1)
            await pool.delete(name.valkey_name, *(job_key_prefix + job.decode() for job in stranded))
            await close_queue(name)


@pytest_asyncio.fixture(loop_scope="session")
async def valkey_namespace(valkey_backend) -> AsyncIterator[str]:
    """A unique key prefix; teardown deletes only keys under it on the shared server."""
    client = get_binary_client()
    if client is None:
        pytest.skip("no Valkey")
    prefix = f"test:{generate_id().hex}:"
    try:
        yield prefix
    finally:
        keys = [key async for key in client.scan_iter(match=f"{prefix}*", count=1000)]
        if keys:
            await client.delete(*keys)


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
    suffix = generate_id().hex[-12:]

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


async def teardown_organizations(
    db_session: AsyncSession, org_ids: Sequence[UUID], user_ids: Sequence[UUID]
) -> None:
    """Delete test organizations, their users and every row the suite or a dev worker gave them."""
    for attempt in range(_TEARDOWN_ATTEMPTS):
        await db_session.rollback()
        try:
            await _delete_organizations(db_session, list(org_ids), list(user_ids))
            await db_session.commit()
            return
        except DBAPIError as exc:
            raced = getattr(exc.orig, "sqlstate", None) in _RACED_BY_WORKERS
            if not raced or attempt == _TEARDOWN_ATTEMPTS - 1:
                raise


async def _delete_organizations(
    db_session: AsyncSession, org_ids: list[UUID], user_ids: list[UUID]
) -> None:
    # Projection takes the document lock before it writes the domain row and then the snapshot,
    # so holding every document lock first keeps these deletes from crossing a projection.
    documents = (
        await db_session.execute(
            select(RealtimeYjsSnapshot.content_type, RealtimeYjsSnapshot.content_id).where(
                RealtimeYjsSnapshot.organization_id.in_(org_ids)
            )
        )
    ).all()
    await lock_documents(db_session, [(row.content_type, row.content_id) for row in documents])
    await db_session.execute(
        delete(RealtimeYjsSnapshot).where(RealtimeYjsSnapshot.organization_id.in_(org_ids))
    )
    # Dev workers deliver notifications, due-date and reminder alerts for these rows.
    await db_session.execute(
        delete(Notification).where(
            or_(
                Notification.organization_id.in_(org_ids),
                Notification.user_id.in_(user_ids),
                Notification.actor_id.in_(user_ids),
            )
        )
    )
    await db_session.execute(delete(Bookmark).where(Bookmark.organization_id.in_(org_ids)))
    comment_ids = (
        await db_session.execute(select(Comment.id).where(Comment.organization_id.in_(org_ids)))
    ).scalars()
    await db_session.execute(
        delete(CommentReaction).where(CommentReaction.comment_id.in_(comment_ids))
    )
    await db_session.execute(delete(Comment).where(Comment.organization_id.in_(org_ids)))
    await db_session.execute(
        delete(SupportSession).where(SupportSession.organization_id.in_(org_ids))
    )
    await db_session.execute(
        delete(ChatAgentFolder).where(ChatAgentFolder.organization_id.in_(org_ids))
    )
    await db_session.execute(delete(Tag).where(Tag.organization_id.in_(org_ids)))
    # Tests grant domain-admin rows, open channels and change defaults; all hold FKs on the org.
    channel_ids = (
        (
            await db_session.execute(
                select(ChatChannel.id).where(ChatChannel.organization_id.in_(org_ids))
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
    await db_session.execute(delete(DomainAdmin).where(DomainAdmin.organization_id.in_(org_ids)))
    await db_session.execute(
        delete(OrganizationPermissionDefaults).where(
            OrganizationPermissionDefaults.organization_id.in_(org_ids)
        )
    )
    await db_session.execute(delete(ContentMember).where(ContentMember.organization_id.in_(org_ids)))
    await db_session.execute(
        delete(ContentAccessRequest).where(ContentAccessRequest.organization_id.in_(org_ids))
    )
    await db_session.execute(delete(Note).where(Note.organization_id.in_(org_ids)))
    await db_session.execute(delete(Task).where(Task.organization_id.in_(org_ids)))
    # Project creation adds fields and views; a test that fails before its own cleanup leaves them.
    project_ids = select(Project.id).where(Project.organization_id.in_(org_ids))
    for child in (FieldDefinition, ViewConfig, Sprint, ProjectSearchAclRefresh):
        await db_session.execute(delete(child).where(child.project_id.in_(project_ids)))
    await db_session.execute(delete(Project).where(Project.organization_id.in_(org_ids)))
    event_ids = (
        (
            await db_session.execute(
                select(CalendarEvent.id).where(CalendarEvent.organization_id.in_(org_ids))
            )
        )
        .scalars()
        .all()
    )
    if event_ids:
        await db_session.execute(delete(EventActivity).where(EventActivity.event_id.in_(event_ids)))
        await db_session.execute(delete(EventReminder).where(EventReminder.event_id.in_(event_ids)))
        await db_session.execute(delete(EventAttendee).where(EventAttendee.event_id.in_(event_ids)))
        await db_session.execute(delete(CalendarEvent).where(CalendarEvent.id.in_(event_ids)))
    await db_session.execute(delete(EventTemplate).where(EventTemplate.organization_id.in_(org_ids)))
    await db_session.execute(delete(Calendar).where(Calendar.organization_id.in_(org_ids)))
    await db_session.execute(
        delete(GroupMember).where(
            GroupMember.group_id.in_(select(Group.id).where(Group.organization_id.in_(org_ids)))
        )
    )
    await db_session.execute(delete(Group).where(Group.organization_id.in_(org_ids)))
    await db_session.execute(delete(Folder).where(Folder.organization_id.in_(org_ids)))
    # Removing an inline upload books its bytes off the uploader's usage row.
    await db_session.execute(delete(StorageUsage).where(StorageUsage.organization_id.in_(org_ids)))
    # audit_events is append-only; teardown is maintenance, so it opts out.
    await db_session.execute(text("SET LOCAL uniffy.audit_maintenance = 'on'"))
    await db_session.execute(delete(AuditEvent).where(AuditEvent.organization_id.in_(org_ids)))
    await db_session.execute(
        delete(OrganizationMember).where(OrganizationMember.organization_id.in_(org_ids))
    )
    await db_session.execute(delete(Organization).where(Organization.id.in_(org_ids)))
    await db_session.execute(delete(User).where(User.id.in_(user_ids)))


@pytest_asyncio.fixture(loop_scope="session")
async def access(session):
    seeded = await _seed_access(session)
    try:
        yield seeded
    finally:
        await teardown_organizations(session, seeded.org_ids, seeded.user_ids)


@pytest_asyncio.fixture(loop_scope="session")
async def buffer(valkey_namespace: str) -> UpdateBuffer:
    return UpdateBuffer(namespace=valkey_namespace, pending_budget_bytes=BUDGET)


@pytest_asyncio.fixture(
    loop_scope="session", params=LIVE_TYPES, ids=[kind.value.lower() for kind in LIVE_TYPES]
)
async def shared(
    request: pytest.FixtureRequest, access: NS, buffer: UpdateBuffer
) -> AsyncIterator[SharedDocument]:
    """The member's explicitly shared note, task or event; the test grants the peer its role."""
    document = await create_document(access, buffer, request.param, AccessMode.EXPLICIT_MEMBERS)
    try:
        yield document
    finally:
        await discard(document.doc.key)
