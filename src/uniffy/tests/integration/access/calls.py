from contextlib import asynccontextmanager
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import event, select, update
from sqlalchemy.orm import with_loader_criteria

from uniffy.core.audit.actions import Action
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.calls.call import Call, CallParticipant, CallType
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.login.user import User
from uniffy.core.models.login.user_session import UserSession
from uniffy.core.types import SubjectType, generate_id
from uniffy.domains.calls import config as calls_config
from uniffy.domains.calls import operations as calls_operations
from uniffy.domains.calls import webhook as calls_webhook
from uniffy.domains.calls.jobs import jobs as calls_jobs
from uniffy.domains.calls.tokens import livekit_room_name
from uniffy.infrastructure.database import open_session


@pytest.fixture(autouse=True)
def livekit(monkeypatch):
    monkeypatch.setattr(calls_config, "_config", None)
    monkeypatch.setenv("LIVEKIT_HOST", "http://livekit:7880")
    monkeypatch.setenv("LIVEKIT_API_KEY", "devkey")
    monkeypatch.setenv("LIVEKIT_API_SECRET", "e" * 48)
    client = MagicMock()
    client.remove_participant = AsyncMock()
    client.delete_room = AsyncMock()
    client.get_participant = AsyncMock()
    client.list_participants = AsyncMock(return_value=[])
    client.list_rooms = AsyncMock(return_value=[])
    monkeypatch.setattr(calls_operations, "get_livekit_admin_client", MagicMock(return_value=client))
    monkeypatch.setattr(calls_webhook, "get_livekit_admin_client", lambda: client)
    monkeypatch.setattr(calls_jobs, "get_livekit_admin_client", lambda: client)
    return client


async def _channel(session, org_id, owner_id, channel_type=ChannelType.PRIVATE) -> ChatChannel:
    suffix = generate_id().hex[-12:]
    channel = ChatChannel(
        organization_id=org_id,
        owner_id=owner_id,
        name=f"room-{suffix}",
        slug=f"room-{suffix}",
        channel_type=channel_type,
    )
    session.add(channel)
    await session.flush()
    session.add(
        ChatChannelMember(
            channel_id=channel.id,
            subject_type=SubjectType.USER,
            subject_id=owner_id,
            user_id=owner_id,
        )
    )
    await session.commit()
    return channel


async def _call(session, access, *, org_id=None, host_id=None) -> Call:
    org_id = org_id or access.org_id
    host_id = host_id or access.owner_id
    channel = await _channel(session, org_id, host_id)
    call = Call(
        organization_id=org_id,
        channel_id=channel.id,
        call_type=CallType.CHANNEL,
        initiator_user_id=host_id,
        host_user_id=host_id,
        livekit_room_name=f"org_{org_id}:call_{generate_id().hex[-12:]}",
    )
    call.livekit_room_name = livekit_room_name(org_id, call.id)
    session.add(call)
    await session.flush()
    session.add(
        CallParticipant(
            call_id=call.id,
            organization_id=org_id,
            user_id=host_id,
            device_id="host",
            identity=f"{host_id}:host",
        )
    )
    await session.commit()
    return call


async def _participant(
    session, call, user_id, *, device="d1", auth_session_id=None
) -> CallParticipant:
    row = CallParticipant(
        call_id=call.id,
        organization_id=call.organization_id,
        user_id=user_id,
        device_id=device,
        identity=f"{user_id}:{device}",
        auth_session_id=auth_session_id,
    )
    session.add(row)
    await session.commit()
    return row


async def _auth_session(session, user_id, org_id, *, revoked=False) -> UserSession:
    row = UserSession(user_id=user_id, organization_id=org_id, is_revoked=revoked)
    session.add(row)
    await session.commit()
    return row


async def _left_at(session, participant_id) -> datetime | None:
    return (
        await session.execute(
            select(CallParticipant.left_at).where(CallParticipant.id == participant_id)
        )
    ).scalar_one()


async def _evictions(session, call_id) -> list[AuditEvent]:
    rows = await session.execute(
        select(AuditEvent).where(
            AuditEvent.action == Action.CALL_PARTICIPANT_EVICTED,
            AuditEvent.resource_id == call_id,
        )
    )
    return list(rows.scalars().all())


async def _make_system_admin(session, user_id) -> None:
    await session.execute(update(User).where(User.id == user_id).values(is_system_admin=True))
    await session.commit()


@pytest.fixture
def scoped_reconciler(access, monkeypatch):
    @asynccontextmanager
    async def open_scoped_session():
        async with open_session() as scoped:

            def restrict_calls(state):
                if state.is_select:
                    state.statement = state.statement.options(
                        with_loader_criteria(Call, Call.organization_id == access.org_id)
                    )

            event.listen(scoped.sync_session, "do_orm_execute", restrict_calls)
            try:
                yield scoped
            finally:
                event.remove(scoped.sync_session, "do_orm_execute", restrict_calls)

    monkeypatch.setattr(calls_jobs, "open_session", open_scoped_session)
    monkeypatch.setattr(calls_jobs, "_acquire_lock", AsyncMock(return_value="token"))
    monkeypatch.setattr(calls_jobs, "_release_lock", AsyncMock())
