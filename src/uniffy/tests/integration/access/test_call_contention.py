import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import func, select, update

from uniffy.core.audit.actions import Action
from uniffy.core.errors import ValidationError
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.calls import Call, CallEndReason, CallParticipant
from uniffy.core.models.chat.channel import ChannelType
from uniffy.domains.calls.metrics import CALL_DURATION, CALLS_ENDED, CALLS_STARTED
from uniffy.domains.calls.operations import CallOperations
from uniffy.domains.chat import calls as events
from uniffy.domains.chat.calls import CallChat
from uniffy.infrastructure.database import open_session
from uniffy.tests.integration.access.call_contention import contend, wait_blocked
from uniffy.tests.integration.access.calls import _call, _channel, _participant
from uniffy.tests.integration.access.calls import livekit as livekit

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest.fixture
def publication(monkeypatch):
    publish = AsyncMock()
    monkeypatch.setattr(CallChat, "publish", publish)
    monkeypatch.setattr(CallChat, "post_system_message", AsyncMock())
    return publish


async def test_simultaneous_ends_publish_and_audit_once(session, access, livekit, publication):
    ended_before = CALLS_ENDED.labels(CallEndReason.HOST_ENDED.value)._value.get()
    duration_before = CALL_DURATION._sum.get()
    call = await _call(session, access)
    await _participant(session, call, access.admin_id)

    async def end(other):
        loaded = await other.get(Call, call.id)
        return await CallOperations(other).end_call_internal(loaded, CallEndReason.HOST_ENDED)

    results = await contend(select(Call).where(Call.id == call.id).with_for_update(), [end, end])
    assert sorted(results) == [False, True]
    assert CALLS_ENDED.labels(CallEndReason.HOST_ENDED.value)._value.get() == ended_before + 1
    assert CALL_DURATION._sum.get() > duration_before
    assert await CallOperations(session).list_active_participants(call.id) == []
    rows = (
        await session.scalars(
            select(AuditEvent).where(
                AuditEvent.resource_id == call.id, AuditEvent.action == Action.CALL_ENDED
            )
        )
    ).all()
    assert len(rows) == 1
    assert rows[0].details["participant_count"] == 2
    assert [c.args[1] for c in publication.await_args_list] == [events.CALL_ENDED]
    livekit.delete_room.assert_awaited_once_with(call.livekit_room_name)


async def test_simultaneous_leaves_close_and_publish_once(session, access, livekit, publication):
    call = await _call(session, access)
    participant = await _participant(session, call, access.admin_id)

    async def leave(other):
        loaded = await other.get(Call, call.id)
        row = await other.get(CallParticipant, participant.id)
        return await CallOperations(other).mark_participant_left(loaded, row)

    results = await contend(
        select(CallParticipant).where(CallParticipant.id == participant.id).with_for_update(),
        [leave, leave],
    )
    assert sorted(results) == [False, True]
    assert [p.user_id for p in await CallOperations(session).list_active_participants(call.id)] == [
        access.owner_id
    ]
    assert [c.args[1] for c in publication.await_args_list] == [events.CALL_PARTICIPANT_LEFT]
    livekit.delete_room.assert_not_awaited()


async def test_simultaneous_starts_share_one_call(
    session, access, livekit, publication, monkeypatch
):
    channel = await _channel(session, access.org_id, access.owner_id, ChannelType.PUBLIC)
    started_before = CALLS_STARTED.labels("CHANNEL")._value.get()
    barrier = asyncio.Barrier(2)
    read = CallOperations.get_active_call_row
    admit = CallOperations._join
    pids = {}

    async def read_then_wait(ops, channel_id):
        row = await read(ops, channel_id)
        if row is None:
            await asyncio.wait_for(barrier.wait(), 10)
        return row

    monkeypatch.setattr(CallOperations, "get_active_call_row", read_then_wait)

    async def admit_after_collision(ops, *args, **kwargs):
        if kwargs.get("is_start"):
            await wait_blocked(
                ops.session, [pid for other, pid in pids.items() if other is not ops.session]
            )
        return await admit(ops, *args, **kwargs)

    monkeypatch.setattr(CallOperations, "_join", admit_after_collision)

    async def start(user_id):
        async with open_session() as other:
            pids[other] = await other.scalar(select(func.pg_backend_pid()))
            return await CallOperations(other).initiate_call(
                user_id, access.org_id, channel.id, "browser"
            )

    async with asyncio.timeout(15), asyncio.TaskGroup() as group:
        starters = [group.create_task(start(uid)) for uid in (access.owner_id, access.admin_id)]
    results = [task.result() for task in starters]
    assert CALLS_STARTED.labels("CHANNEL")._value.get() == started_before + 1
    assert results[0][0].id == results[1][0].id
    assert sorted(r[3] for r in results) == [False, True]
    call_id = results[0][0].id
    assert len(await CallOperations(session).list_active_participants(call_id)) == 2
    audits = (
        await session.scalars(
            select(AuditEvent).where(
                AuditEvent.resource_id == call_id, AuditEvent.action == Action.CALL_STARTED
            )
        )
    ).all()
    assert len(audits) == 1
    assert sum(c.args[1] == events.CALL_STARTED for c in publication.await_args_list) == 1


async def test_simultaneous_joins_to_different_calls_admit_only_one(
    session, access, livekit, publication
):
    calls = [await _call(session, access), await _call(session, access)]

    def join(call):
        async def run(other):
            return await CallOperations(other).join_call(
                access.admin_id, access.org_id, call.id, "browser"
            )

        return run

    results = await contend(
        select(Call).where(Call.id.in_([c.id for c in calls])).order_by(Call.id).with_for_update(),
        [join(call) for call in calls],
    )
    assert sum(isinstance(r, tuple) for r in results) == 1
    assert sum(isinstance(r, ValidationError) and "another channel" in str(r) for r in results) == 1
    active = (
        await session.scalars(
            select(CallParticipant).where(
                CallParticipant.user_id == access.admin_id, CallParticipant.left_at.is_(None)
            )
        )
    ).all()
    assert len(active) == 1


@pytest.mark.parametrize("same_device", [False, True])
async def test_simultaneous_device_joins_respect_identity_and_cap(
    session, access, livekit, publication, same_device
):
    call = await _call(session, access)
    await _participant(session, call, access.admin_id, device="existing")

    def join(device):
        async def run(other):
            return await CallOperations(other).join_call(
                access.admin_id, access.org_id, call.id, device
            )

        return run

    results = await contend(
        select(Call).where(Call.id == call.id).with_for_update(),
        [join("new"), join("new" if same_device else "extra")],
    )
    assert sum(isinstance(r, tuple) for r in results) == (2 if same_device else 1)
    if not same_device:
        assert (
            sum(isinstance(r, ValidationError) and "too many devices" in str(r) for r in results)
            == 1
        )
    rows = [
        p
        for p in await CallOperations(session).list_active_participants(call.id)
        if p.user_id == access.admin_id
    ]
    assert len(rows) == 2
    assert next(p for p in rows if p.device_id == "new").mic_enabled is False


async def test_host_succession_racing_departure_keeps_active_host(
    session, access, livekit, publication
):
    call = await _call(session, access)
    first = await _participant(session, call, access.admin_id)
    last = await _participant(session, call, access.member_id)
    await session.execute(
        update(CallParticipant)
        .where(CallParticipant.call_id == call.id, CallParticipant.user_id == access.owner_id)
        .values(left_at=datetime.now(UTC))
    )
    await session.commit()

    async def handoff(other):
        await CallOperations(other).reassign_host_if_absent(await other.get(Call, call.id))

    async def leave(other):
        return await CallOperations(other).mark_participant_left(
            await other.get(Call, call.id), await other.get(CallParticipant, first.id)
        )

    results = await contend(
        select(Call).where(Call.id == call.id).with_for_update(), [handoff, leave]
    )
    assert not any(isinstance(r, BaseException) for r in results), results
    assert await session.scalar(select(Call.host_user_id).where(Call.id == call.id)) == last.user_id


async def test_rejoin_clears_absence_before_waiting_ghost_cleanup(
    session, access, livekit, publication
):
    call = await _call(session, access)
    row = await _participant(session, call, access.admin_id)
    cutoff = datetime.now(UTC) - timedelta(minutes=1)
    row.missing_since = cutoff - timedelta(minutes=1)
    await session.commit()
    async with open_session() as joining, open_session() as retiring:
        stale = await retiring.get(CallParticipant, row.id)
        loaded = await retiring.get(Call, call.id)
        pid = await retiring.scalar(select(func.pg_backend_pid()))
        await joining.execute(
            select(CallParticipant).where(CallParticipant.id == row.id).with_for_update()
        )
        task = asyncio.create_task(
            CallOperations(retiring).retire_ghost_participant(loaded, stale, cutoff)
        )
        try:
            await wait_blocked(joining, [pid])
            await CallOperations(joining).join_call(
                access.admin_id, access.org_id, call.id, row.device_id
            )
            assert await asyncio.wait_for(task, 10) is False
        finally:
            await joining.rollback()
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)
    await session.refresh(row)
    assert row.left_at is None
    assert row.missing_since is None


async def test_simultaneous_host_handoffs_publish_once(session, access, livekit, publication):
    call = await _call(session, access)
    successor = await _participant(session, call, access.admin_id)
    await session.execute(
        update(CallParticipant)
        .where(CallParticipant.call_id == call.id, CallParticipant.user_id == access.owner_id)
        .values(left_at=datetime.now(UTC))
    )
    await session.commit()

    async def handoff(other):
        await CallOperations(other).reassign_host_if_absent(await other.get(Call, call.id))

    results = await contend(
        select(Call).where(Call.id == call.id).with_for_update(), [handoff, handoff]
    )
    assert results == [None, None]
    assert (
        await session.scalar(select(Call.host_user_id).where(Call.id == call.id))
        == successor.user_id
    )
    assert [c.args[1] for c in publication.await_args_list] == [events.CALL_HOST_CHANGED]


async def test_join_waiting_on_end_cannot_reopen_call(session, access, livekit, publication):
    call = await _call(session, access)
    async with open_session() as ending, open_session() as joining:
        loaded = await ending.scalar(select(Call).where(Call.id == call.id).with_for_update())
        pid = await joining.scalar(select(func.pg_backend_pid()))
        task = asyncio.create_task(
            CallOperations(joining).join_call(access.admin_id, access.org_id, call.id, "browser")
        )
        try:
            await wait_blocked(ending, [pid])
            await CallOperations(ending).end_call_internal(loaded, CallEndReason.HOST_ENDED)
            with pytest.raises(ValidationError, match="Call has ended"):
                await asyncio.wait_for(task, 10)
        finally:
            await ending.rollback()
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)
    assert await CallOperations(session).list_active_participants(call.id) == []
    livekit.create_room.assert_not_awaited()


async def test_rejoin_waiting_on_ghost_retirement_creates_fresh_active_row(
    session, access, livekit, publication, monkeypatch
):
    call = await _call(session, access)
    row = await _participant(session, call, access.admin_id)
    row.missing_since = datetime.now(UTC) - timedelta(minutes=2)
    await session.commit()
    prepared, release = asyncio.Event(), asyncio.Event()
    async with open_session() as retiring, open_session() as joining:
        commit = retiring.commit

        async def delayed_commit():
            if not prepared.is_set():
                prepared.set()
                await release.wait()
            await commit()

        monkeypatch.setattr(retiring, "commit", delayed_commit)
        ghost = asyncio.create_task(
            CallOperations(retiring).retire_ghost_participant(
                await retiring.get(Call, call.id),
                await retiring.get(CallParticipant, row.id),
                datetime.now(UTC) - timedelta(minutes=1),
            )
        )
        join = None
        try:
            await asyncio.wait_for(prepared.wait(), 10)
            pid = await joining.scalar(select(func.pg_backend_pid()))
            join = asyncio.create_task(
                CallOperations(joining).join_call(
                    access.admin_id, access.org_id, call.id, row.device_id
                )
            )
            await wait_blocked(session, [pid])
            release.set()
            assert await asyncio.wait_for(ghost, 10) is True
            await asyncio.wait_for(join, 10)
        finally:
            release.set()
            for task in (ghost, join):
                if task is not None and not task.done():
                    task.cancel()
            await asyncio.gather(
                *(t for t in (ghost, join) if t is not None), return_exceptions=True
            )
    await session.refresh(row)
    assert row.left_at is not None
    active = [
        p
        for p in await CallOperations(session).list_active_participants(call.id)
        if p.user_id == access.admin_id
    ]
    assert len(active) == 1 and active[0].id != row.id


async def test_end_audit_failure_rolls_back_terminal_rows(
    session, access, livekit, publication, monkeypatch
):
    ended_before = CALLS_ENDED.labels(CallEndReason.HOST_ENDED.value)._value.get()
    call = await _call(session, access)
    monkeypatch.setattr(
        "uniffy.domains.calls.operations.write_audit_event",
        AsyncMock(side_effect=RuntimeError("audit unavailable")),
    )
    with pytest.raises(RuntimeError, match="audit unavailable"):
        async with open_session() as other:
            await CallOperations(other).end_call_internal(
                await other.get(Call, call.id), CallEndReason.HOST_ENDED
            )
    await session.refresh(call)
    assert CALLS_ENDED.labels(CallEndReason.HOST_ENDED.value)._value.get() == ended_before
    assert call.ended_at is None
    assert len(await CallOperations(session).list_active_participants(call.id)) == 1
    assert (
        await session.scalars(
            select(AuditEvent).where(
                AuditEvent.resource_id == call.id, AuditEvent.action == Action.CALL_ENDED
            )
        )
    ).all() == []
    livekit.delete_room.assert_not_awaited()
    publication.assert_not_awaited()
