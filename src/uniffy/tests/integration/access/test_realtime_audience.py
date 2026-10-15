import asyncio
import contextlib
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pycrdt
import pytest
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.notes.note import Note
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.realtime import session as transport
from uniffy.core.realtime.adapter import register_realtime_adapter
from uniffy.core.realtime.multiplex import encode_doc_frame, peek_var_string
from uniffy.core.realtime.state import WSSession, YDocSession, doc_name_for
from uniffy.core.realtime.wire import create_update_message
from uniffy.core.realtime.ydoc_manager import YDocManager
from uniffy.core.types import ContentRole, ContentType, SubjectType
from uniffy.domains.notes.adapter import NoteRealtimeAdapter

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_audience_matches_point_checks_for_all_actors(
    session: AsyncSession,
    access: SimpleNamespace,
) -> None:
    adapter = NoteRealtimeAdapter(MagicMock())
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
    adapter = NoteRealtimeAdapter(MagicMock())
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


async def test_outbound_batch_rechecks_revocation_without_pubsub(
    session: AsyncSession,
    access: SimpleNamespace,
) -> None:
    adapter = NoteRealtimeAdapter(MagicMock())
    register_realtime_adapter(adapter)
    manager = YDocManager()
    key = (ContentType.NOTE, access.shared_note_id)
    resident = YDocSession(key=key, ydoc=pycrdt.Doc(), organization_id=access.org_id)
    manager._sessions[key] = resident
    sockets = [
        WSSession(
            user_id=actor,
            organization_id=access.org_id,
            token_version=0,
            conn_id=index,
            ws=MagicMock(send_bytes=AsyncMock()),
        )
        for index, actor in enumerate([access.member_id, access.peer_id])
    ]
    for socket in sockets:
        manager._attach_client(resident, socket, can_edit=False)
    frame = encode_doc_frame(doc_name_for(key), create_update_message(b"\x00\x00"))
    pumps = []

    async def wait_for_frames(count):
        async with asyncio.timeout(5):
            while any(socket.ws.send_bytes.await_count < count for socket in sockets):
                await asyncio.sleep(0.001)

    with (
        patch.object(transport, "ydoc_manager", manager),
        patch.object(manager, "refresh_fragment_seeder", AsyncMock()),
    ):
        try:
            pumps = [
                asyncio.create_task(transport._pump_outbound(socket.ws, socket))
                for socket in sockets
            ]
            for socket in sockets:
                socket.outbound.put_nowait(frame)
            await wait_for_frames(1)
            await session.execute(
                update(ContentMember)
                .where(
                    ContentMember.content_id == key[1],
                    ContentMember.subject_id == access.peer_id,
                )
                .values(role=ContentRole.BLOCKED)
            )
            await session.commit()
            for socket in sockets:
                socket.outbound.put_nowait(frame)
            await wait_for_frames(2)
            assert sockets[0].ws.send_bytes.call_args.args[0] == frame
            denied = sockets[1].ws.send_bytes.call_args.args[0]
            _, offset = peek_var_string(denied)
            assert denied[offset] == 2
            assert key in sockets[1].denied_docs
            assert key not in sockets[0].denied_docs
        finally:
            for pump in pumps:
                pump.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await pump
            for socket in sockets:
                await manager.release_all(socket)
            if resident.eviction_task:
                resident.eviction_task.cancel()
