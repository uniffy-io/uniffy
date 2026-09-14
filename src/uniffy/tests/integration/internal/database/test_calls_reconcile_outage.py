"""Duration cleanup remains authoritative when media requests fail."""

from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import delete, event, select
from sqlalchemy.orm import with_loader_criteria

from uniffy.core.models.calls import Call, CallEndReason, CallParticipant
from uniffy.core.models.calls.call import CallType
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.types import generate_id
from uniffy.domains.calls import config as calls_config
from uniffy.domains.calls import operations as calls_operations
from uniffy.domains.calls.jobs import jobs as calls_jobs
from uniffy.domains.calls.livekit import LiveKitAdminClient
from uniffy.infrastructure.database import open_session
from uniffy.infrastructure.valkey import queue as queue_module
from uniffy.infrastructure.valkey.queue import QueueName

pytestmark = pytest.mark.asyncio(loop_scope="session")

OVERLONG_HOURS = calls_jobs.DEFAULT_MAX_DURATION_MINUTES / 60 + 1


class _NullQueue:
    async def enqueue_job(self, *args, **kwargs):
        return None


@pytest.fixture(autouse=True)
def _livekit_env(monkeypatch):
    monkeypatch.setattr(calls_config, "_config", None)
    monkeypatch.setenv("LIVEKIT_HOST", "http://livekit:7880")
    monkeypatch.setenv("LIVEKIT_API_KEY", "devkey")
    monkeypatch.setenv("LIVEKIT_API_SECRET", "r" * 48)


@pytest.fixture
def scoped_reconciler(env, monkeypatch):
    """A global maintenance job must only see this test's call candidates."""
    organization_id = env.org_id

    @asynccontextmanager
    async def open_scoped_session():
        async with open_session() as scoped:

            def restrict_calls(state):
                if state.is_select:
                    state.statement = state.statement.options(
                        with_loader_criteria(Call, Call.organization_id == organization_id)
                    )

            event.listen(scoped.sync_session, "do_orm_execute", restrict_calls)
            try:
                yield scoped
            finally:
                event.remove(scoped.sync_session, "do_orm_execute", restrict_calls)

    monkeypatch.setattr(calls_jobs, "open_session", open_scoped_session)
    monkeypatch.setattr(calls_jobs, "_acquire_lock", AsyncMock(return_value="token"))
    monkeypatch.setattr(calls_jobs, "_release_lock", AsyncMock())
    monkeypatch.setitem(queue_module._pools, QueueName.CORE, _NullQueue())
    monkeypatch.setitem(queue_module._pools, QueueName.EGRESS, _NullQueue())


async def _channel(session, env) -> ChatChannel:
    # UUID timestamp prefixes collide when channels share a creation tick.
    suffix = generate_id().hex[-10:]
    channel = ChatChannel(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        name=f"calls-{suffix}",
        slug=f"calls-{suffix}",
        channel_type=ChannelType.PRIVATE,
    )
    session.add(channel)
    await session.flush()
    return channel


async def _call(session, env, channel, *, started_at: datetime) -> Call:
    call = Call(
        organization_id=env.org_id,
        channel_id=channel.id,
        call_type=CallType.CHANNEL,
        initiator_user_id=env.admin_id,
        host_user_id=env.admin_id,
        livekit_room_name=f"org_{env.org_id}:call_{generate_id().hex[-12:]}",
        started_at=started_at,
    )
    session.add(call)
    await session.flush()
    session.add(
        CallParticipant(
            call_id=call.id,
            organization_id=env.org_id,
            user_id=env.admin_id,
            device_id="device-1",
            identity=f"{env.admin_id}:device-1",
            joined_at=started_at,
        )
    )
    return call


@pytest.mark.parametrize("failure", [TimeoutError("media unreachable"), 503])
@pytest.mark.parametrize("expired_first", [False, True])
async def test_an_overlong_call_still_ends_while_the_media_service_is_down(
    session, env, second_env, scoped_reconciler, monkeypatch, failure, expired_first
) -> None:
    now = datetime.now(UTC)
    ages = [timedelta(minutes=1), timedelta(minutes=2)]
    ages.insert(0 if expired_first else 2, timedelta(hours=OVERLONG_HOURS))
    calls = []
    channel_ids = []
    for age in ages:
        channel = await _channel(session, env)
        channel_ids.append(channel.id)
        calls.append(await _call(session, env, channel, started_at=now - age))
    other_channel = await _channel(session, second_env)
    channel_ids.append(other_channel.id)
    unrelated = await _call(
        session, second_env, other_channel, started_at=now - timedelta(hours=OVERLONG_HOURS)
    )
    await session.commit()
    call_ids = [call.id for call in calls]
    overlong_id = call_ids[0 if expired_first else 2]
    unrelated_id = unrelated.id

    media = LiveKitAdminClient(calls_config.get_livekit_config())
    response = MagicMock(status=failure)
    media._http = MagicMock()
    media._http.post = AsyncMock(
        side_effect=failure if isinstance(failure, Exception) else None,
        return_value=response,
    )
    monkeypatch.setattr(calls_jobs, "get_livekit_admin_client", lambda: media)
    monkeypatch.setattr(calls_operations, "get_livekit_admin_client", lambda: media)

    try:
        result = await calls_jobs.reconcile_calls({})

        assert result["status"] == "success"
        assert result["ended"] == 1
        assert result["media_reachable"] is False
        media._http.post.assert_awaited_once()

        await session.rollback()
        # Scalar reads observe committed state instead of cached ORM objects.
        ended_at, end_reason = (
            await session.execute(
                select(Call.ended_at, Call.end_reason).where(Call.id == overlong_id)
            )
        ).one()
        assert ended_at is not None
        assert end_reason == CallEndReason.MAX_DURATION
        for call_id in [*call_ids, unrelated_id]:
            if call_id != overlong_id:
                assert (
                    await session.execute(select(Call.ended_at).where(Call.id == call_id))
                ).scalar_one() is None
    finally:
        await session.rollback()
        for call_id in [*call_ids, unrelated_id]:
            await session.execute(delete(CallParticipant).where(CallParticipant.call_id == call_id))
            await session.execute(delete(Call).where(Call.id == call_id))
        await session.execute(delete(ChatChannel).where(ChatChannel.id.in_(channel_ids)))
        await session.commit()
