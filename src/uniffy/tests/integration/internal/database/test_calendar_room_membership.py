from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import delete, select

from uniffy.core.models.calendar.activity import EventActivity
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_member import ChannelRole, ChatChannelMember
from uniffy.core.types import AttendeeRole, AttendeeStatus, SubjectType, generate_id
from uniffy.domains.scheduling.calendar.operations import CalendarEventOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_attendee_removal_revokes_auto_created_room_membership(
    session,
    env,
    search_indexer,
) -> None:
    suffix = generate_id().hex[:10]
    calendar = Calendar(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        name=f"Auto room calendar {suffix}",
        color="#123456",
    )
    channel = ChatChannel(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        name=f"Auto room {suffix}",
        slug=f"auto-room-{suffix}",
        channel_type=ChannelType.PRIVATE,
    )
    session.add_all([calendar, channel])
    await session.flush()

    event = CalendarEvent(
        organization_id=env.org_id,
        organizer_id=env.admin_id,
        calendar_id=calendar.id,
        title=f"Auto room event {suffix}",
        start_time=datetime.now(UTC) + timedelta(days=1),
        end_time=datetime.now(UTC) + timedelta(days=1, hours=1),
        channel_id=channel.id,
        channel_auto_created=True,
    )
    session.add_all([
        ChatChannelStats(channel_id=channel.id, member_count=2),
        ChatChannelMember(
            channel_id=channel.id,
            subject_type=SubjectType.USER,
            subject_id=env.admin_id,
            user_id=env.admin_id,
            role=ChannelRole.OWNER,
        ),
        ChatChannelMember(
            channel_id=channel.id,
            subject_type=SubjectType.USER,
            subject_id=env.member_id,
            user_id=env.member_id,
            role=ChannelRole.MEMBER,
        ),
        event,
    ])
    await session.flush()
    session.add_all([
        EventAttendee(
            event_id=event.id,
            user_id=env.admin_id,
            role=AttendeeRole.ORGANIZER,
            status=AttendeeStatus.ACCEPTED,
        ),
        EventAttendee(
            event_id=event.id,
            user_id=env.member_id,
            role=AttendeeRole.REQUIRED,
            status=AttendeeStatus.ACCEPTED,
        ),
    ])
    await session.commit()
    calendar_id = calendar.id
    channel_id = channel.id
    event_id = event.id

    lifecycle = MagicMock()
    lifecycle.remove_member = AsyncMock()

    try:
        await CalendarEventOperations(session, search_indexer).remove_attendees(
            user_id=env.admin_id,
            organization_id=env.org_id,
            event_id=event.id,
            attendee_ids=[env.member_id],
            call_lifecycle=lifecycle,
        )

        attendee = await session.scalar(
            select(EventAttendee).where(
                EventAttendee.event_id == event_id,
                EventAttendee.user_id == env.member_id,
            )
        )
        room_member = await session.scalar(
            select(ChatChannelMember).where(
                ChatChannelMember.channel_id == channel_id,
                ChatChannelMember.user_id == env.member_id,
            )
        )
        assert attendee is None
        assert room_member is None
        lifecycle.remove_member.assert_awaited_once_with(session, channel_id, env.member_id)
    finally:
        await session.rollback()
        await session.execute(delete(EventAttendee).where(EventAttendee.event_id == event_id))
        await session.execute(delete(EventActivity).where(EventActivity.event_id == event_id))
        await session.execute(delete(CalendarEvent).where(CalendarEvent.id == event_id))
        await session.execute(delete(ChatChannel).where(ChatChannel.id == channel_id))
        await session.execute(delete(Calendar).where(Calendar.id == calendar_id))
        await session.commit()
