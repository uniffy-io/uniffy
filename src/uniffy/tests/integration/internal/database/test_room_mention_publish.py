"""Room updates publish the full denormalized chip payload, clears included."""

import pytest
from sqlalchemy import delete

from uniffy.core.models.rooms.room import Room
from uniffy.domains.scheduling.rooms.lifecycle import RoomOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_room_update_publishes_cleared_fields(
    session, env, search_indexer, monkeypatch
) -> None:
    published: list[tuple[str, dict]] = []

    async def capture(organization_id, urn, changes):
        published.append((urn, dict(changes)))

    monkeypatch.setattr("uniffy.domains.scheduling.rooms.lifecycle.publish_mention_state", capture)

    room_ops = RoomOperations(session, search_indexer)
    try:
        room = await room_ops.create_room(
            env.admin_id,
            env.org_id,
            name="itdb-room",
            building="Sofia HQ",
            capacity=8,
        )

        published.clear()
        await room_ops.update_room(env.admin_id, env.org_id, room.id, building="")

        assert len(published) == 1
        _, changes = published[0]
        # Blanked field arrives as an explicit empty string so open chips clear it.
        assert changes["building"] == ""
        assert changes["capacity"] == "8"
        assert changes["room_type"] == room.room_type.value
        assert changes["floor"] == ""
    finally:
        await session.rollback()
        await session.execute(delete(Room).where(Room.organization_id == env.org_id))
        await session.commit()
