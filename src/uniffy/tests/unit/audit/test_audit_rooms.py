"""Destructive-action audit emissions for rooms.

Create / update (with archive detection on status -> RETIRED) / delete.
"""

from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.audit.actions import Action
from uniffy.core.models.rooms.room import Room
from uniffy.core.types import AccessMode, RoomStatus, RoomType, generate_id


def _audit_rows(session: MagicMock) -> list:
    return [
        call.args[0]
        for call in session.add.call_args_list
        if call.args and call.args[0].__class__.__name__ == "AuditEvent"
    ]


def _build_session() -> MagicMock:
    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.flush = AsyncMock()
    session.refresh = AsyncMock()
    session.rollback = AsyncMock()
    session.delete = AsyncMock()
    return session


def _make_room(**overrides) -> Room:
    defaults = dict(
        id=generate_id(),
        organization_id=generate_id(),
        owner_id=generate_id(),
        name="Boardroom",
        description="",
        room_type=RoomType.CONFERENCE_ROOM,
        capacity=10,
        status=RoomStatus.ACTIVE,
        amenities=[],
        is_deleted=False,
    )
    defaults.update(overrides)
    return Room(**defaults)


async def test_create_room_emits_room_created() -> None:
    from uniffy.domains.rooms.operations import RoomOperations

    session = _build_session()
    ops = RoomOperations(session)
    ops._index_for_search = AsyncMock()

    with patch.object(
        RoomOperations,
        "_resolve_access_policy",
        AsyncMock(return_value=(None, None)),
    ):
        await ops.create_room(
            user_id=generate_id(),
            organization_id=generate_id(),
            name="Phone Booth",
        )

    rows = _audit_rows(session)
    created = [r for r in rows if r.action == Action.ROOM_CREATED]
    assert len(created) == 1
    assert created[0].details["name"] == "Phone Booth"


async def test_update_room_status_to_retired_emits_archived() -> None:
    from uniffy.domains.rooms.operations import RoomOperations

    room = _make_room(status=RoomStatus.ACTIVE)
    session = _build_session()
    ops = RoomOperations(session)
    ops._index_for_search = AsyncMock()

    with (
        patch.object(RoomOperations, "get_by_id", AsyncMock(return_value=room)),
        patch.object(RoomOperations, "_require_edit", AsyncMock(return_value=None)),
        patch.object(
            RoomOperations,
            "_effective_policy",
            AsyncMock(return_value=(AccessMode.OPEN_TO_ORG, None)),
        ),
    ):
        await ops.update_room(
            user_id=generate_id(),
            organization_id=room.organization_id,
            room_id=room.id,
            status=RoomStatus.RETIRED,
        )

    rows = _audit_rows(session)
    archived = [r for r in rows if r.action == Action.ROOM_ARCHIVED]
    assert len(archived) == 1
    assert archived[0].details["changed_keys"] == ["status"]


async def test_delete_room_emits_room_deleted() -> None:
    from uniffy.domains.rooms.operations import RoomOperations

    room = _make_room()
    session = _build_session()
    future_count_result = MagicMock()
    future_count_result.scalar.return_value = 0
    session.execute = AsyncMock(return_value=future_count_result)

    ops = RoomOperations(session)
    ops.search_indexer = MagicMock(remove=AsyncMock())

    with (
        patch.object(RoomOperations, "get_by_id", AsyncMock(return_value=room)),
        patch.object(RoomOperations, "_require_delete", AsyncMock(return_value=None)),
    ):
        await ops.delete_room(
            user_id=generate_id(),
            organization_id=room.organization_id,
            room_id=room.id,
        )

    rows = _audit_rows(session)
    deleted = [r for r in rows if r.action == Action.ROOM_DELETED]
    assert len(deleted) == 1
    assert deleted[0].details["permanent"] is False
