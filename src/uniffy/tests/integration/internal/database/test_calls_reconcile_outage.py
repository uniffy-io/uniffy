"""A media outage must not stop the reconciler doing the work it still can.

Ending a call that has run past its limit is a clock comparison against rows we
own. It needs nothing from the media service, so an outage is no reason to skip
it - and skipping it leaves calls running for the length of the outage.
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import delete, select

from uniffy.core.models.calls import Call, CallEndReason, CallParticipant
from uniffy.core.models.calls.call import CallType
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.types import generate_id
from uniffy.domains.calls import config as calls_config
from uniffy.domains.calls.jobs import jobs as calls_jobs
from uniffy.domains.calls.livekit import LiveKitUnavailableError
from uniffy.infrastructure.valkey import queue as queue_module
from uniffy.infrastructure.valkey.queue import QueueName

pytestmark = pytest.mark.asyncio(loop_scope="session")

OVERLONG_HOURS = calls_jobs.DEFAULT_MAX_DURATION_MINUTES / 60 + 1


class _DeadMediaService:
    """Every roster read fails, the way an unreachable SFU behaves."""

    def __init__(self) -> None:
        self.roster_reads = 0

    async def list_participants(self, room_name: str):
        self.roster_reads += 1
        raise LiveKitUnavailableError("media service unreachable")

    async def delete_room(self, room_name: str) -> None:
        raise LiveKitUnavailableError("media service unreachable")


class _NullQueue:
    """Accepts a dispatch and drops it."""

    async def enqueue_job(self, *args, **kwargs):
        return None


@pytest.fixture(autouse=True)
def _livekit_env(monkeypatch):
    monkeypatch.setattr(calls_config, "_config", None)
    monkeypatch.setenv("LIVEKIT_HOST", "http://livekit:7880")
    monkeypatch.setenv("LIVEKIT_API_KEY", "devkey")
    monkeypatch.setenv("LIVEKIT_API_SECRET", "r" * 48)


async def _channel(session, env) -> ChatChannel:
    # The leading hex of a uuidv7 is a millisecond timestamp, so two channels
    # created in the same tick would collide on the org/slug unique index.
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


async def test_an_overlong_call_still_ends_while_the_media_service_is_down(
    session, env, monkeypatch
) -> None:
    """The reconciler used to abandon the pass at the first unreachable call, so
    every call behind it in the round was left alone."""
    now = datetime.now(UTC)
    first = await _channel(session, env)
    second = await _channel(session, env)
    # Ordered by row id, so the healthy-age call is reached first and is what
    # trips the outage; the overlong one is only reached if the pass continues.
    recent = await _call(session, env, first, started_at=now - timedelta(minutes=5))
    overlong = await _call(session, env, second, started_at=now - timedelta(hours=OVERLONG_HOURS))
    await session.commit()
    # Plain values: these ORM objects expire on the rollbacks below, and touching
    # an expired attribute outside the session's greenlet is its own failure.
    recent_id, overlong_id = recent.id, overlong.id
    channel_ids = [first.id, second.id]
    assert recent_id < overlong_id

    media = _DeadMediaService()
    monkeypatch.setattr(calls_jobs, "get_livekit_admin_client", lambda: media)
    # The ops Valkey client only exists inside a worker process, and the lock is
    # not what this measures - its ownership check is already correct.
    monkeypatch.setattr(calls_jobs, "_acquire_lock", AsyncMock(return_value="token"))
    monkeypatch.setattr(calls_jobs, "_release_lock", AsyncMock(return_value=None))
    # Ending a call fans out through the job queue, which only exists inside a
    # worker; enqueueing for real would hand jobs to the running dev worker. The
    # pool registry is the one seam every dispatch path reads.
    monkeypatch.setitem(queue_module._pools, QueueName.CORE, _NullQueue())
    monkeypatch.setitem(queue_module._pools, QueueName.EGRESS, _NullQueue())

    try:
        result = await calls_jobs.reconcile_calls({})

        assert result["status"] == "success"
        assert result["ended"] == 1
        assert result["media_reachable"] is False
        # One read, not one per call: the outage is a property of the pass.
        assert media.roster_reads == 1

        await session.rollback()
        # Columns, not entities: the identity map still holds the rows this test
        # created and would hand them back unchanged.
        ended_at, end_reason = (
            await session.execute(
                select(Call.ended_at, Call.end_reason).where(Call.id == overlong_id)
            )
        ).one()
        recent_ended_at = (
            await session.execute(select(Call.ended_at).where(Call.id == recent_id))
        ).scalar_one()
        assert ended_at is not None
        assert end_reason == CallEndReason.MAX_DURATION
        assert recent_ended_at is None
    finally:
        await session.rollback()
        for call_id in (recent_id, overlong_id):
            await session.execute(delete(CallParticipant).where(CallParticipant.call_id == call_id))
            await session.execute(delete(Call).where(Call.id == call_id))
        await session.execute(delete(ChatChannel).where(ChatChannel.id.in_(channel_ids)))
        await session.commit()
