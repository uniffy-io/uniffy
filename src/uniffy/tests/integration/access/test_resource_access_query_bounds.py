from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.chat.agent_folder import ChatAgentFolder
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.sprint import Sprint as _Sprint  # noqa: F401 - FK metadata
from uniffy.core.models.projects.task import Task
from uniffy.core.models.tags.tag import Tag, TagAssignment
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType, generate_id
from uniffy.domains.permissions.access import (
    ResourceAccessPurpose,
    ResourceAccessResolver,
    ResourceKey,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _statement_count(
    session: AsyncSession,
    *,
    actor_id,
    organization_id,
    keys: list[ResourceKey],
) -> int:
    count = 0
    engine = session.bind.sync_engine

    def before_cursor_execute(*_args) -> None:
        nonlocal count
        count += 1

    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    try:
        await ResourceAccessResolver(session).resolve(
            actor_id=actor_id,
            organization_id=organization_id,
            keys=keys,
            purpose=ResourceAccessPurpose.SEARCH,
        )
    finally:
        event.remove(engine, "before_cursor_execute", before_cursor_execute)
    return count


async def test_custom_policy_statement_counts_are_candidate_size_invariant(
    session: AsyncSession,
    access,
) -> None:
    now = datetime.now(UTC)
    project = Project(
        organization_id=access.org_id,
        owner_id=access.member_id,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.EDITOR,
        name="Query-bound project",
        slug=f"query-bound-{generate_id().hex[:8]}",
    )
    calendar = Calendar(
        organization_id=access.org_id,
        owner_id=access.member_id,
        name="Query-bound calendar",
    )
    session.add_all([project, calendar])
    await session.flush()

    tasks = [
        Task(
            organization_id=access.org_id,
            project_id=project.id,
            owner_id=access.member_id,
            title=f"Query-bound task {index}",
            number=index + 1,
        )
        for index in range(8)
    ]
    events = [
        CalendarEvent(
            organization_id=access.org_id,
            organizer_id=access.member_id,
            calendar_id=calendar.id,
            title=f"Query-bound event {index}",
            start_time=now + timedelta(hours=index),
            end_time=now + timedelta(hours=index + 1),
            access_mode=AccessMode.OWNER_ONLY,
        )
        for index in range(8)
    ]
    channels = [
        ChatChannel(
            organization_id=access.org_id,
            owner_id=access.member_id,
            name=f"Query-bound channel {index}",
            slug=f"query-bound-{index}-{generate_id().hex[:8]}",
            channel_type=ChannelType.PRIVATE,
        )
        for index in range(8)
    ]
    folders = [
        ChatAgentFolder(
            organization_id=access.org_id,
            user_id=access.peer_id,
            name=f"Query-bound folder {index}",
        )
        for index in range(8)
    ]
    tags = [
        Tag(
            organization_id=access.org_id,
            name=f"Query-bound tag {index}",
            slug=f"query-bound-tag-{index}-{generate_id().hex[:8]}",
            created_by=access.member_id,
        )
        for index in range(8)
    ]
    session.add_all([*tasks, *events, *channels, *folders, *tags])
    await session.flush()
    session.add_all([
        *(EventAttendee(event_id=row.id, user_id=access.peer_id) for row in events),
        *(
            ChatChannelMember(
                channel_id=row.id,
                subject_type=SubjectType.USER,
                subject_id=access.peer_id,
                user_id=access.peer_id,
            )
            for row in channels
        ),
        *(
            TagAssignment(
                tag_id=row.id,
                content_urn=f"urn:uniffy:content:NOTE:{access.shared_note_id}",
                content_type=ContentType.NOTE.value,
                sources=["manual"],
                assigned_by=access.member_id,
            )
            for row in tags
        ),
    ])
    await session.commit()

    batches = [
        [ResourceKey(ContentType.TASK, row.id) for row in tasks],
        [ResourceKey(ContentType.CALENDAR_EVENT, row.id) for row in events],
        [ResourceKey(ContentType.CHAT, row.id) for row in channels],
        [ResourceKey(ContentType.AGENT_FOLDER, row.id) for row in folders],
        [ResourceKey(ContentType.TAG, row.id) for row in tags],
    ]
    for keys in batches:
        one = await _statement_count(
            session,
            actor_id=access.peer_id,
            organization_id=access.org_id,
            keys=keys[:1],
        )
        many = await _statement_count(
            session,
            actor_id=access.peer_id,
            organization_id=access.org_id,
            keys=keys,
        )
        assert one == many
