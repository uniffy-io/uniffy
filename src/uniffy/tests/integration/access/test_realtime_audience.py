"""Who hears a live document: batched authorization audiences, awareness and slow readers."""

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.json_codec import dumps_str, loads
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.notes.note import Note
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.realtime.multiplex import (
    read_var_string,
    read_var_uint,
    write_var_string,
    write_var_uint,
)
from uniffy.core.realtime.state import OUTBOUND_BYTES_MAX
from uniffy.core.realtime.wire import MESSAGE_QUERY_AWARENESS, YMessageType, YSyncMessageType
from uniffy.core.realtime.ydoc_manager import YDocManager
from uniffy.core.types import ContentRole, ContentType, SubjectType, generate_id
from uniffy.domains.notes.adapter import NoteRealtimeAdapter
from uniffy.tests.integration.access.realtime_live import (
    BufferedDocument,
    live_note,  # noqa: F401 - fixture
)
from uniffy.tests.integration.access.realtime_sockets import (
    attached,
    evicted,
    kinds,
    replica,
    step,
)
from uniffy.tests.integration.access.recording_search import recording_indexer

pytestmark = pytest.mark.asyncio(loop_scope="session")


def awareness(client_id: int, state: dict[str, Any] | None) -> bytes:
    body = (
        write_var_uint(1)
        + write_var_uint(client_id)
        + write_var_uint(1)
        + write_var_string(dumps_str(state))
    )
    return bytes([YMessageType.AWARENESS]) + write_var_uint(len(body)) + body


def awareness_state(payload: bytes) -> dict[str, Any]:
    _, offset = read_var_uint(payload, 1)
    for _ in range(3):
        _, offset = read_var_uint(payload, offset)
    raw, _ = read_var_string(payload, offset, max_bytes=len(payload))
    return loads(raw)


@pytest_asyncio.fixture(loop_scope="session")
async def manager(live_note: BufferedDocument) -> AsyncIterator[YDocManager]:
    manager = replica(live_note.buffer)
    yield manager
    await manager.drain_for_shutdown()
    await evicted(manager, live_note.key)


async def test_audience_matches_point_checks_for_all_actors(
    session: AsyncSession,
    access: SimpleNamespace,
) -> None:
    adapter = NoteRealtimeAdapter(recording_indexer())
    for note_id in (
        access.private_note_id,
        access.shared_note_id,
        access.org_note_id,
        access.blocked_note_id,
        access.admin_note_id,
        access.group_note_id,
    ):
        roles = await adapter.authorize_many(session, access.user_ids, access.org_id, note_id)
        for actor in access.user_ids:
            assert roles[actor] == await adapter.authorize(session, actor, access.org_id, note_id)
        assert await adapter.authorize_many(
            session,
            access.user_ids,
            access.other_org_id,
            note_id,
        ) == dict.fromkeys(access.user_ids)


async def test_audience_reads_new_group_block_expiry_and_membership_facts(
    session: AsyncSession,
    access: SimpleNamespace,
) -> None:
    adapter = NoteRealtimeAdapter(recording_indexer())
    actors = [access.member_id, access.peer_id, access.admin_id]

    async def roles():
        return await adapter.authorize_many(session, actors, access.org_id, access.group_note_id)

    initial = await roles()
    assert initial[access.peer_id] is not None
    await session.execute(
        update(GroupMember)
        .where(
            GroupMember.group_id == access.access_group_id,
            GroupMember.user_id == access.peer_id,
        )
        .values(is_active=False)
    )
    await session.commit()
    assert (await roles())[access.peer_id] is None
    await session.execute(
        update(GroupMember)
        .where(
            GroupMember.group_id == access.access_group_id,
            GroupMember.user_id == access.peer_id,
        )
        .values(is_active=True)
    )
    await session.execute(
        update(ContentMember)
        .where(
            ContentMember.content_id == access.group_note_id,
            ContentMember.subject_type == SubjectType.GROUP,
        )
        .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
    )
    await session.commit()
    assert (await roles())[access.peer_id] is None
    await session.execute(
        update(ContentMember)
        .where(
            ContentMember.content_id == access.group_note_id,
            ContentMember.subject_type == SubjectType.GROUP,
        )
        .values(expires_at=None, role=ContentRole.BLOCKED)
    )
    await session.commit()
    assert (await roles())[access.peer_id] is None
    await session.execute(
        update(OrganizationMember)
        .where(
            OrganizationMember.organization_id == access.org_id,
            OrganizationMember.user_id == access.member_id,
        )
        .values(is_active=False)
    )
    await session.commit()
    assert (await roles())[access.member_id] is None


async def test_batch_limit_fails_before_query(
    session: AsyncSession, access: SimpleNamespace
) -> None:
    note = await session.get(Note, access.private_note_id)
    with pytest.raises(ValueError, match="batch limit"):
        await PermissionChecker(session).effective_roles(
            [UUID(int=i) for i in range(257)],
            access.org_id,
            ContentType.NOTE,
            note.id,
            owner_id=note.owner_id,
            access_mode=note.access_mode,
            baseline_role=note.baseline_role,
        )


async def test_awareness_carries_the_authenticated_identity_and_refuses_peer_removal(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    async with (
        attached(manager, live_note) as (sender, _),
        attached(manager, live_note) as (peer, _),
    ):
        sender.send(awareness(10, {"user": {"id": str(generate_id()), "name": "Forged"}, "x": 3}))
        frame, _ = await peer.until(YMessageType.AWARENESS)
        state = awareness_state(frame)
        assert state["user"] == {
            "id": str(live_note.owner),
            "name": "Member Tester",
            "hasAvatar": False,
        }
        assert state["x"] == 3
        sender.send(awareness(11, None))
        sender.send(awareness(10, {"x": 4}))
        frame, _ = await peer.until(YMessageType.AWARENESS)
        assert awareness_state(frame)["x"] == 4


async def test_awareness_query_reaches_peers_but_not_its_sender(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    query = bytes([MESSAGE_QUERY_AWARENESS])
    async with (
        attached(manager, live_note) as (asker, _),
        attached(manager, live_note) as (peer, _),
    ):
        asker.send(query)
        frame, _ = await peer.until(MESSAGE_QUERY_AWARENESS)
        assert frame == query
        assert MESSAGE_QUERY_AWARENESS not in kinds(await asker.drain())


async def test_awareness_query_relays_only_the_canonical_byte_once_per_handle(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    query = bytes([MESSAGE_QUERY_AWARENESS])
    async with (
        attached(manager, live_note) as (viewer, _),
        attached(manager, live_note) as (padded, _),
        attached(manager, live_note) as (peer, _),
    ):
        padded.send(query + b"x" * 60_000)
        viewer.send(query)
        for _ in range(20):
            viewer.send(query)

        relayed = [frame for frame in await peer.drain() if frame[0] == MESSAGE_QUERY_AWARENESS]
        assert relayed == [query]
        assert viewer.socket.closes == padded.socket.closes == peer.socket.closes == []


async def test_slow_reader_drops_frames_past_its_outbound_budget_without_holding_up_peers(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    padding = "x" * 60_000
    sent = OUTBOUND_BYTES_MAX // len(padding) + 20
    async with (
        attached(manager, live_note) as (sender, _),
        attached(manager, live_note) as (reader, _),
    ):
        reader.socket.hold_send = asyncio.Event()
        for count in range(sent):
            sender.send(awareness(10, {"n": count, "pad": padding}))
        # The sender's own traffic still flows while the reader's socket is stuck.
        sender.sync()
        await sender.until(YMessageType.SYNC, step(YSyncMessageType.SYNC_STEP2))
        reader.socket.hold_send.set()

        received = [
            awareness_state(frame)["n"]
            for frame in await reader.drain()
            if frame[0] == YMessageType.AWARENESS
        ]
        assert 0 < len(received) < sent
        assert received == sorted(received)
        assert reader.socket.closes == []
