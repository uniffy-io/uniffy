"""Room updates publish the full denormalized chip payload, clears included."""

from unittest.mock import AsyncMock

import pytest
from sqlalchemy import delete

from uniffy.core.models.rooms.room import Room
from uniffy.core.search.indexer import SearchIndexer
from uniffy.domains.rooms.operations import RoomOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_room_update_publishes_cleared_fields(session, env, monkeypatch) -> None:
    monkeypatch.setattr(SearchIndexer, "index", AsyncMock())
    published: list[tuple[str, dict, bool]] = []

    async def capture(organization_id, urn, changes, restricted=False):
        published.append((urn, dict(changes), restricted))

    monkeypatch.setattr("uniffy.domains.rooms.operations.publish_mention_state", capture)

    room_ops = RoomOperations(session)
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
        _, changes, restricted = published[0]
        # Blanked field arrives as an explicit empty string so open chips clear it.
        assert changes["building"] == ""
        assert changes["capacity"] == "8"
        assert changes["room_type"] == room.room_type.value
        assert changes["floor"] == ""
        # Rooms default to OPEN_TO_ORG, so the broadcast stays org-wide.
        assert restricted is False
    finally:
        await session.rollback()
        await session.execute(delete(Room).where(Room.organization_id == env.org_id))
        await session.commit()
