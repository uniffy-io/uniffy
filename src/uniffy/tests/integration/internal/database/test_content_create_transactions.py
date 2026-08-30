from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import delete, func, select

from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.calendar.activity import EventActivity
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.reminder import EventReminder
from uniffy.core.models.files.file import File
from uniffy.core.models.files.multipart_part import MultipartPart
from uniffy.core.models.files.multipart_upload import MultipartUpload, UploadStatus
from uniffy.core.models.notes.note import Note
from uniffy.core.models.projects.field_definition import FieldDefinition
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.view_config import ViewConfig
from uniffy.core.models.rooms.booking import RoomBooking
from uniffy.core.models.rooms.room import Room
from uniffy.core.types import AccessMode, ContentRole, RoomType, generate_id
from uniffy.domains.calendar.operations import CalendarEventOperations
from uniffy.domains.files.operations import FileOperations
from uniffy.domains.notes.operations import NoteOperations
from uniffy.domains.projects.operations import ProjectOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _delete_project(session, organization_id, name: str) -> None:
    project_ids = list(
        (
            await session.execute(
                select(Project.id).where(
                    Project.organization_id == organization_id,
                    Project.name == name,
                )
            )
        ).scalars()
    )
    if project_ids:
        await session.execute(delete(ViewConfig).where(ViewConfig.project_id.in_(project_ids)))
        await session.execute(
            delete(FieldDefinition).where(FieldDefinition.project_id.in_(project_ids))
        )
        await session.execute(delete(Project).where(Project.id.in_(project_ids)))


async def _delete_calendar(session, calendar_id) -> None:
    event_ids = list(
        (
            await session.execute(
                select(CalendarEvent.id).where(CalendarEvent.calendar_id == calendar_id)
            )
        ).scalars()
    )
    if event_ids:
        await session.execute(delete(EventReminder).where(EventReminder.event_id.in_(event_ids)))
        await session.execute(delete(EventActivity).where(EventActivity.event_id.in_(event_ids)))
        await session.execute(delete(EventAttendee).where(EventAttendee.event_id.in_(event_ids)))
        await session.execute(delete(CalendarEvent).where(CalendarEvent.id.in_(event_ids)))
    await session.execute(delete(Calendar).where(Calendar.id == calendar_id))


async def test_project_create_rolls_back_defaults_when_tag_validation_fails(
    session, env, search_indexer
) -> None:
    name = f"Rollback project {generate_id().hex[:10]}"

    try:
        with pytest.raises(NotFoundError):
            await ProjectOperations(session, search_indexer=search_indexer).create(
                user_id=env.admin_id,
                organization_id=env.org_id,
                name=name,
                tag_ids=[generate_id()],
            )

        assert (
            await session.scalar(
                select(func.count())
                .select_from(Project)
                .where(Project.organization_id == env.org_id, Project.name == name)
            )
            == 0
        )
    finally:
        await session.rollback()
        await _delete_project(session, env.org_id, name)
        await session.commit()


async def test_note_create_rolls_back_when_tag_validation_fails(
    session, env, search_indexer
) -> None:
    title = f"Rollback note {generate_id().hex[:10]}"

    try:
        with pytest.raises(NotFoundError):
            await NoteOperations(session, search_indexer=search_indexer).create(
                user_id=env.admin_id,
                organization_id=env.org_id,
                title=title,
                tag_ids=[generate_id()],
            )

        assert (
            await session.scalar(
                select(func.count())
                .select_from(Note)
                .where(Note.organization_id == env.org_id, Note.title == title)
            )
            == 0
        )
    finally:
        await session.rollback()
        await session.execute(
            delete(Note).where(Note.organization_id == env.org_id, Note.title == title)
        )
        await session.commit()


async def test_file_upload_rolls_back_before_storage_completion_when_tag_validation_fails(
    session,
    env,
    search_indexer,
) -> None:
    upload = MultipartUpload(
        organization_id=env.org_id,
        user_id=env.admin_id,
        s3_upload_id=f"upload-{generate_id()}",
        storage_key=f"test/{generate_id()}",
        storage_bucket="test",
        filename=f"rollback-{generate_id().hex[:10]}.txt",
        mime_type="text/plain",
        total_size=4,
        total_chunks=1,
        chunk_size=4,
        access_mode=AccessMode.OWNER_ONLY,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    upload_id = upload.id
    filename = upload.filename
    session.add(upload)
    await session.flush()
    part = MultipartPart(
        upload_id=upload.id,
        part_number=1,
        etag="test-etag",
        size=4,
    )
    session.add(part)
    await session.commit()

    operations = FileOperations(session, search_indexer=search_indexer)
    operations.s3 = MagicMock()
    operations.s3.complete_multipart_upload = AsyncMock()

    try:
        with pytest.raises(NotFoundError):
            await operations.complete_upload(
                upload_id,
                env.admin_id,
                tag_ids=[generate_id()],
            )

        assert (
            await session.scalar(
                select(func.count()).select_from(File).where(File.filename == filename)
            )
            == 0
        )
        status = await session.scalar(
            select(MultipartUpload.status).where(MultipartUpload.id == upload_id)
        )
        assert status == UploadStatus.ACTIVE
        operations.s3.complete_multipart_upload.assert_not_awaited()
    finally:
        await session.rollback()
        await session.execute(delete(MultipartPart).where(MultipartPart.upload_id == upload_id))
        await session.execute(delete(MultipartUpload).where(MultipartUpload.id == upload_id))
        await session.commit()


async def test_calendar_event_create_rolls_back_children_when_tag_validation_fails(
    session,
    env,
    search_indexer,
) -> None:
    calendar = Calendar(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        name=f"Transaction calendar {generate_id().hex[:10]}",
    )
    session.add(calendar)
    await session.commit()
    calendar_id = calendar.id
    title = f"Rollback event {generate_id().hex[:10]}"
    start_time = datetime.now(UTC) + timedelta(days=1)

    try:
        with pytest.raises(NotFoundError):
            await CalendarEventOperations(session, search_indexer).create(
                user_id=env.admin_id,
                organization_id=env.org_id,
                title=title,
                start_time=start_time,
                end_time=start_time + timedelta(hours=1),
                calendar_id=calendar_id,
                attendee_ids=[env.member_id],
                reminders=[15],
                tag_ids=[generate_id()],
            )

        assert (
            await session.scalar(
                select(func.count())
                .select_from(CalendarEvent)
                .where(
                    CalendarEvent.organization_id == env.org_id,
                    CalendarEvent.title == title,
                )
            )
            == 0
        )
    finally:
        await session.rollback()
        await _delete_calendar(session, calendar_id)
        await session.commit()


async def test_calendar_event_and_room_booking_roll_back_together_on_late_conflict(
    session,
    env,
    search_indexer,
) -> None:
    calendar = Calendar(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        name=f"Booking calendar {generate_id().hex[:10]}",
    )
    room = Room(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        name=f"Booking room {generate_id().hex[:10]}",
        room_type=RoomType.MEETING_ROOM,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.VIEWER,
    )
    session.add_all([calendar, room])
    await session.commit()
    calendar_id = calendar.id
    room_id = room.id
    title = f"Conflicted event {generate_id().hex[:10]}"
    start_time = datetime.now(UTC) + timedelta(days=1)

    try:
        with (
            patch(
                "uniffy.domains.rooms.queries.check_booking_conflict",
                new=AsyncMock(side_effect=[False, True]),
            ),
            pytest.raises(ValidationError, match="already booked"),
        ):
            await CalendarEventOperations(session, search_indexer).create(
                user_id=env.admin_id,
                organization_id=env.org_id,
                title=title,
                start_time=start_time,
                end_time=start_time + timedelta(hours=1),
                calendar_id=calendar_id,
                room_id=room_id,
            )

        assert (
            await session.scalar(
                select(func.count())
                .select_from(CalendarEvent)
                .where(
                    CalendarEvent.organization_id == env.org_id,
                    CalendarEvent.title == title,
                )
            )
            == 0
        )
        assert (
            await session.scalar(
                select(func.count()).select_from(RoomBooking).where(RoomBooking.room_id == room_id)
            )
            == 0
        )
    finally:
        await session.rollback()
        await session.execute(delete(RoomBooking).where(RoomBooking.room_id == room_id))
        await _delete_calendar(session, calendar_id)
        await session.execute(delete(Room).where(Room.id == room_id))
        await session.commit()
