from datetime import UTC, datetime, timedelta
from enum import StrEnum

import pytest
from sqlalchemy import select

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.exception import RecurrenceException
from uniffy.core.models.calls import Call
from uniffy.core.models.chat.channel import ChannelType
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    EventStatus,
    EventVisibility,
    RecurrencePattern,
)
from uniffy.domains.calls.history import CallHistoryReader
from uniffy.domains.calls.operations import CallOperations
from uniffy.domains.scheduling.calendar.recurrence import OCCURRENCE_ID_SEPARATOR
from uniffy.tests.integration.access.calls import _auth_session, _channel
from uniffy.tests.integration.access.calls import call_publication as call_publication
from uniffy.tests.integration.access.calls import livekit as livekit

pytestmark = pytest.mark.asyncio(loop_scope="session")


class EventFailure(StrEnum):
    PRIVATE = "private"
    HIDDEN = "hidden"
    DELETED = "deleted"
    CHANNEL = "channel"
    CANCELLED = "cancelled"
    ORG = "org"
    INVALID = "invalid"


async def meeting(session, access):
    channel = await _channel(session, access.org_id, access.owner_id, ChannelType.PUBLIC)
    calendar = Calendar(
        organization_id=access.org_id,
        owner_id=access.owner_id,
        name="Meetings",
        access_mode=AccessMode.OWNER_ONLY,
    )
    session.add(calendar)
    await session.flush()
    start = datetime.now(UTC).replace(microsecond=0)
    event = CalendarEvent(
        organization_id=access.org_id,
        organizer_id=access.owner_id,
        calendar_id=calendar.id,
        title="Planning review",
        start_time=start,
        end_time=start + timedelta(hours=1),
        access_mode=AccessMode.OWNER_ONLY,
        channel_id=channel.id,
    )
    session.add(event)
    await session.commit()
    return channel, event


async def start(session, access, channel, event_id=None, *, user_id=None, title=None):
    user_id = user_id or access.owner_id
    auth = await _auth_session(session, user_id, access.org_id)
    return await CallOperations(session).initiate_call(
        user_id,
        access.org_id,
        channel.id,
        "web",
        auth_session_id=auth.id,
        calendar_event_id=event_id,
        title=title,
    )


async def test_meeting_title_is_snapshotted_and_existing_calls_keep_it(
    session, access, livekit, call_publication
):
    channel, event = await meeting(session, access)
    expected_title = event.title
    call, _, _, joined = await start(session, access, channel, str(event.id))
    assert not joined
    assert call.title == expected_title
    event.title = "Renamed event"
    renamed_channel = "Renamed channel"
    channel.name = renamed_channel
    await session.commit()
    joined_call, _, _, joined = await start(
        session, access, channel, str(event.id), user_id=access.member_id
    )
    assert joined
    assert joined_call.id == call.id
    record, _, _ = await CallHistoryReader(session).get_record(
        access.owner_id, access.org_id, call.id
    )
    assert record.title == expected_title
    await session.refresh(channel)
    assert channel.name == renamed_channel


async def test_channel_start_ignores_linked_events(session, access, livekit, call_publication):
    channel, event = await meeting(session, access)
    call, _, _, _ = await start(session, access, channel)
    assert call.title == channel.effective_name
    joined_call, _, _, joined = await start(session, access, channel, str(event.id))
    assert joined
    assert joined_call.title == channel.effective_name


@pytest.mark.parametrize("failure", list(EventFailure))
async def test_event_naming_requires_visible_bound_event(
    session, access, livekit, call_publication, failure
):
    channel, event = await meeting(session, access)
    user_id = access.owner_id
    expected = ValidationError
    reference = str(event.id)
    if failure == EventFailure.PRIVATE:
        user_id = access.member_id
        expected = PermissionDeniedError
    elif failure == EventFailure.HIDDEN:
        event.access_mode = AccessMode.OPEN_TO_ORG
        event.baseline_role = ContentRole.VIEWER
        event.visibility = EventVisibility.PRIVATE
        user_id = access.member_id
        expected = PermissionDeniedError
    elif failure == EventFailure.DELETED:
        event.is_deleted = True
        expected = NotFoundError
    elif failure == EventFailure.CHANNEL:
        event.channel_id = None
    elif failure == EventFailure.CANCELLED:
        event.status = EventStatus.CANCELLED
    elif failure == EventFailure.ORG:
        event.organization_id = access.other_org_id
        expected = NotFoundError
    else:
        reference = "invalid"
    await session.commit()
    with pytest.raises(expected):
        await start(session, access, channel, reference, user_id=user_id)
    assert await session.scalar(select(Call.id).where(Call.channel_id == channel.id)) is None
    livekit.create_room.assert_not_awaited()


@pytest.mark.parametrize("changed", [False, True])
async def test_recurring_meeting_uses_occurrence_title(
    session, access, livekit, call_publication, changed
):
    channel, event = await meeting(session, access)
    event.recurrence_pattern = RecurrencePattern.DAILY
    event.recurrence_config = {"interval": 1}
    await session.commit()
    day = event.start_time.date() + timedelta(days=1)
    expected_title = event.title
    if changed:
        override = CalendarEvent(
            organization_id=access.org_id,
            organizer_id=access.owner_id,
            calendar_id=event.calendar_id,
            recurrence_id=event.id,
            title="Special planning review",
            start_time=event.start_time + timedelta(days=1),
            end_time=event.end_time + timedelta(days=1),
            channel_id=channel.id,
            access_mode=AccessMode.OWNER_ONLY,
        )
        session.add(override)
        await session.flush()
        session.add(
            RecurrenceException(event_id=event.id, original_date=day, override_event_id=override.id)
        )
        await session.commit()
        expected_title = override.title
    reference = f"{event.id}{OCCURRENCE_ID_SEPARATOR}{day.isoformat()}"
    call, _, _, _ = await start(session, access, channel, reference)
    assert call.title == expected_title


@pytest.mark.parametrize("from_event", [False, True])
async def test_custom_name_is_trimmed_and_preserved(
    session, access, livekit, call_publication, from_event
):
    channel, event = await meeting(session, access)
    original_channel_name = channel.name
    title = "P0 checkout debugging"
    reference = str(event.id) if from_event else None
    call, _, _, _ = await start(session, access, channel, reference, title=f"  {title}  ")
    record, _, _ = await CallHistoryReader(session).get_record(
        access.owner_id, access.org_id, call.id
    )
    assert record.title == title
    await session.refresh(channel)
    assert channel.name == original_channel_name
    joined_call, _, _, joined = await start(
        session, access, channel, title="Different name", user_id=access.member_id
    )
    assert joined
    assert joined_call.id == call.id
    assert joined_call.title == title


@pytest.mark.parametrize("from_event", [False, True])
async def test_blank_call_name_uses_default(session, access, livekit, call_publication, from_event):
    channel, event = await meeting(session, access)
    reference = str(event.id) if from_event else None
    call, _, _, _ = await start(session, access, channel, reference, title="   ")
    assert call.title == (event.title if from_event else channel.effective_name)


@pytest.mark.parametrize("title", ["x" * 501, "P0\ndebugging", "P0\0debugging"])
async def test_invalid_call_name_creates_no_call(session, access, livekit, call_publication, title):
    channel, _ = await meeting(session, access)
    with pytest.raises(ValidationError):
        await start(session, access, channel, title=title)
    assert await session.scalar(select(Call.id).where(Call.channel_id == channel.id)) is None
    livekit.create_room.assert_not_awaited()


async def test_call_name_accepts_storage_limit(session, access, livekit, call_publication):
    channel, _ = await meeting(session, access)
    title = "x" * 500
    call, _, _, _ = await start(session, access, channel, title=title)
    assert call.title == title
