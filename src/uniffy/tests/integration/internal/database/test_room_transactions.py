"""Room mutation transactions against PostgreSQL."""

import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import delete, func, select, text

from uniffy.core.audit.actions import Action
from uniffy.core.errors import ValidationError
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.login.group import Group
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.rooms.booking import RoomBooking
from uniffy.core.models.rooms.room import Room
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    RoomType,
    SubjectType,
    generate_id,
)
from uniffy.infrastructure.database import open_session
from uniffy.domains.permissions.members import ContentMembersOperations
from uniffy.domains.scheduling.rooms.bookings import BookingOperations
from uniffy.domains.scheduling.rooms.lifecycle import RoomOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")

ROLLBACK_ROOM_NAME = "Atomic room rollback"
UPDATED_ROOM_NAME = "Updated despite projection failure"


async def _cleanup(session, organization_id, group_ids=()) -> None:
    await session.rollback()
    await session.execute(delete(RoomBooking).where(RoomBooking.organization_id == organization_id))
    await session.execute(
        delete(ContentMember).where(
            ContentMember.organization_id == organization_id,
            ContentMember.content_type == ContentType.ROOM,
        )
    )
    await session.execute(delete(Room).where(Room.organization_id == organization_id))
    if group_ids:
        await session.execute(delete(Group).where(Group.id.in_(group_ids)))
    await session.execute(text("SET LOCAL uniffy.audit_maintenance = 'on'"))
    await session.execute(delete(AuditEvent).where(AuditEvent.organization_id == organization_id))
    await session.commit()


async def _audit_count(session, organization_id, action: Action) -> int:
    return int(
        (
            await session.execute(
                select(func.count())
                .select_from(AuditEvent)
                .where(AuditEvent.organization_id == organization_id, AuditEvent.action == action)
            )
        ).scalar_one()
    )


async def test_room_creation_rolls_back_when_initial_share_staging_fails(
    session, env, search_indexer, monkeypatch
) -> None:
    group = Group(
        organization_id=env.org_id,
        name=f"room rollback {generate_id().hex[:8]}",
        slug=f"room-rollback-{generate_id().hex[:8]}",
        created_by_user_id=env.admin_id,
    )
    session.add(group)
    await session.commit()
    group_id = group.id
    monkeypatch.setattr(
        "uniffy.domains.permissions.members.record_member_added",
        AsyncMock(side_effect=RuntimeError("member audit unavailable")),
    )

    try:
        with pytest.raises(RuntimeError, match="member audit unavailable"):
            await RoomOperations(session, search_indexer).create_room(
                env.admin_id,
                env.org_id,
                name=ROLLBACK_ROOM_NAME,
                access_mode=AccessMode.EXPLICIT_MEMBERS,
                group_ids=[group_id],
            )

        room_count = (
            await session.execute(
                select(func.count())
                .select_from(Room)
                .where(Room.organization_id == env.org_id, Room.name == ROLLBACK_ROOM_NAME)
            )
        ).scalar_one()
        member_count = (
            await session.execute(
                select(func.count())
                .select_from(ContentMember)
                .where(
                    ContentMember.organization_id == env.org_id,
                    ContentMember.content_type == ContentType.ROOM,
                )
            )
        ).scalar_one()
        assert room_count == 0
        assert member_count == 0
        assert await _audit_count(session, env.org_id, Action.ROOM_CREATED) == 0
        assert await _audit_count(session, env.org_id, Action.PERMISSIONS_MEMBER_ADDED) == 0
    finally:
        await _cleanup(session, env.org_id, [group_id])


async def test_room_and_initial_group_share_commit_before_search_failure(
    session, env, search_indexer, monkeypatch
) -> None:
    group = Group(
        organization_id=env.org_id,
        name=f"room share {generate_id().hex[:8]}",
        slug=f"room-share-{generate_id().hex[:8]}",
        created_by_user_id=env.admin_id,
    )
    session.add(group)
    await session.commit()
    group_id = group.id
    monkeypatch.setattr(
        ContentMembersOperations,
        "finish_member_add_after_commit",
        AsyncMock(),
    )
    monkeypatch.setattr(
        RoomOperations,
        "_index_for_search",
        AsyncMock(side_effect=RuntimeError("search unavailable")),
    )

    try:
        room = await RoomOperations(session, search_indexer).create_room(
            env.admin_id,
            env.org_id,
            name="Atomic shared room",
            access_mode=AccessMode.EXPLICIT_MEMBERS,
            group_ids=[group_id],
        )
        member = (
            await session.execute(
                select(ContentMember).where(
                    ContentMember.organization_id == env.org_id,
                    ContentMember.content_type == ContentType.ROOM,
                    ContentMember.content_id == room.id,
                    ContentMember.subject_type == SubjectType.GROUP,
                    ContentMember.subject_id == group_id,
                )
            )
        ).scalar_one()

        assert member.content_id == room.id
        assert await _audit_count(session, env.org_id, Action.ROOM_CREATED) == 1
        assert await _audit_count(session, env.org_id, Action.PERMISSIONS_MEMBER_ADDED) == 1
    finally:
        await _cleanup(session, env.org_id, [group_id])


async def test_room_update_and_delete_survive_projection_failures(
    session, env, search_indexer, monkeypatch
) -> None:
    operations = RoomOperations(session, search_indexer)
    room = await operations.create_room(
        env.admin_id,
        env.org_id,
        name="Projection failure room",
    )
    monkeypatch.setattr(
        RoomOperations,
        "_index_for_search",
        AsyncMock(side_effect=RuntimeError("search unavailable")),
    )
    monkeypatch.setattr(
        "uniffy.domains.scheduling.rooms.lifecycle.publish_mention_state",
        AsyncMock(side_effect=RuntimeError("realtime unavailable")),
    )

    try:
        updated = await operations.update_room(
            env.admin_id,
            env.org_id,
            room.id,
            name=UPDATED_ROOM_NAME,
        )
        assert updated.name == UPDATED_ROOM_NAME
        assert await _audit_count(session, env.org_id, Action.ROOM_UPDATED) == 1

        search_indexer.remove = AsyncMock(side_effect=RuntimeError("search removal unavailable"))
        await operations.delete_room(env.admin_id, env.org_id, room.id)
        await session.refresh(room)

        assert room.is_deleted is True
        assert await _audit_count(session, env.org_id, Action.ROOM_DELETED) == 1
    finally:
        await _cleanup(session, env.org_id)


async def test_concurrent_room_bookings_serialize_conflict_check(session, env) -> None:
    room = Room(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        name=f"Concurrent booking {generate_id().hex[:8]}",
        room_type=RoomType.MEETING_ROOM,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.VIEWER,
    )
    session.add(room)
    await session.commit()
    room_id = room.id
    start_time = datetime.now(UTC) + timedelta(days=1)
    end_time = start_time + timedelta(hours=1)

    async def create_booking():
        async with open_session() as isolated:
            return await BookingOperations(isolated).create_booking(
                user_id=env.admin_id,
                organization_id=env.org_id,
                room_id=room_id,
                start_time=start_time,
                end_time=end_time,
            )

    try:
        outcomes = await asyncio.gather(create_booking(), create_booking(), return_exceptions=True)
        successes = [outcome for outcome in outcomes if isinstance(outcome, RoomBooking)]
        conflicts = [outcome for outcome in outcomes if isinstance(outcome, ValidationError)]

        assert len(successes) == 1
        assert len(conflicts) == 1
        assert (
            await session.scalar(
                select(func.count()).select_from(RoomBooking).where(RoomBooking.room_id == room_id)
            )
            == 1
        )
    finally:
        await _cleanup(session, env.org_id)
