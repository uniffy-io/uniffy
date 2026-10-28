import asyncio
from contextlib import asynccontextmanager

import pytest
from sqlalchemy import func, select

from uniffy.core.audit.actions import Action
from uniffy.core.json_codec import dumps_str
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.calls import Call, CallEndReason, CallParticipant
from uniffy.domains.calls import webhook as webhook_module
from uniffy.domains.calls.operations import CallOperations
from uniffy.domains.calls.tokens import livekit_room_name
from uniffy.domains.calls.webhook import LiveKitWebhookProvider
from uniffy.domains.chat import calls as events
from uniffy.infrastructure.database import open_session
from uniffy.tests.integration.access.call_contention import wait_blocked
from uniffy.tests.integration.access.calls import _call, _participant
from uniffy.tests.integration.access.calls import call_publication as call_publication
from uniffy.tests.integration.access.calls import livekit as livekit

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_rejoin_racing_already_read_leave_event_keeps_replacement(
    session, access, livekit, call_publication, monkeypatch
):
    call = await _call(session, access)
    row = await _participant(session, call, access.admin_id)
    row.token_jti = row.session_jti = "departing"
    await session.commit()
    pids = []
    ready = asyncio.Event()

    @asynccontextmanager
    async def event_session():
        async with open_session() as other:
            pids.append(await other.scalar(select(func.pg_backend_pid())))
            ready.set()
            yield other

    monkeypatch.setattr(webhook_module, "open_session", event_session)
    async with open_session() as joining:
        await joining.execute(
            select(CallParticipant).where(CallParticipant.id == row.id).with_for_update()
        )
        task = asyncio.create_task(
            LiveKitWebhookProvider().process(_event(call, row, "participant_left", "departing"))
        )
        try:
            await asyncio.wait_for(ready.wait(), 10)
            await wait_blocked(joining, pids)
            await CallOperations(joining).join_call(
                access.admin_id, access.org_id, call.id, row.device_id
            )
            await asyncio.wait_for(task, 10)
        finally:
            await joining.rollback()
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)
    await session.refresh(row)
    assert row.left_at is None
    assert row.session_jti != "departing"
    call_publication.assert_not_awaited()


def _event(call, participant, event, jti):
    return {
        "event": event,
        "room": {"name": call.livekit_room_name},
        "participant": {"identity": participant.identity, "metadata": dumps_str({"jti": jti})},
    }


@pytest.mark.parametrize("event", ["participant_left", "participant_connection_aborted"])
async def test_duplicate_leave_events_after_refresh_close_once(
    session, access, livekit, call_publication, event
):
    call = await _call(session, access)
    row = await _participant(session, call, access.admin_id)
    row.token_jti = "connected"
    row.session_jti = "connected"
    await session.commit()
    ops = CallOperations(session)
    await ops.refresh_token(access.admin_id, access.org_id, call.id, row.device_id)
    await ops.refresh_token(access.admin_id, access.org_id, call.id, row.device_id)
    provider = LiveKitWebhookProvider()
    payload = _event(call, row, event, "connected")
    await provider.process(payload)
    await provider.process(payload)
    await session.refresh(row)
    assert row.left_at is not None
    assert [c.args[1] for c in call_publication.await_args_list] == [events.CALL_PARTICIPANT_LEFT]


@pytest.mark.parametrize("event", ["participant_left", "participant_connection_aborted"])
async def test_delayed_departure_cannot_close_rejoined_device(
    session, access, livekit, call_publication, event
):
    call = await _call(session, access)
    row = await _participant(session, call, access.admin_id)
    row.token_jti = row.session_jti = "old"
    await session.commit()
    await CallOperations(session).join_call(access.admin_id, access.org_id, call.id, row.device_id)
    provider = LiveKitWebhookProvider()
    await provider.process(_event(call, row, event, "old"))
    await session.refresh(row)
    assert row.left_at is None
    call_publication.assert_not_awaited()
    await provider.process(_event(call, row, event, row.session_jti))
    await session.refresh(row)
    assert row.left_at is not None


async def test_room_finish_is_idempotent_and_closes_survivors(
    session, access, livekit, call_publication
):
    call = await _call(session, access)
    await _participant(session, call, access.admin_id)
    provider = LiveKitWebhookProvider()
    event = {"event": "room_finished", "room": {"name": call.livekit_room_name}}
    await provider.process(event)
    await provider.process(event)
    await session.refresh(call)
    assert call.end_reason == CallEndReason.ALL_LEFT
    assert await CallOperations(session).list_active_participants(call.id) == []
    assert (
        len(
            (
                await session.scalars(
                    select(AuditEvent).where(
                        AuditEvent.resource_id == call.id, AuditEvent.action == Action.CALL_ENDED
                    )
                )
            ).all()
        )
        == 1
    )
    livekit.delete_room.assert_awaited_once_with(call.livekit_room_name)


@pytest.mark.parametrize(
    "event", ["participant_left", "participant_connection_aborted", "room_finished"]
)
async def test_webhook_room_must_match_call_organization(
    session, access, livekit, call_publication, event
):
    call = await _call(session, access)
    row = await _participant(session, call, access.admin_id)
    payload = _event(call, row, event, "current")
    payload["room"]["name"] = livekit_room_name(access.other_org_id, call.id)
    await LiveKitWebhookProvider().process(payload)
    await session.refresh(call)
    await session.refresh(row)
    assert call.ended_at is None and row.left_at is None
    livekit.delete_room.assert_not_awaited()
    call_publication.assert_not_awaited()


async def test_delayed_join_checks_current_media_generation(
    session, access, livekit, call_publication
):
    call = await _call(session, access)
    row = await _participant(session, call, access.admin_id)
    row.token_jti = row.session_jti = "current"
    await session.commit()
    livekit.get_participant.return_value = {
        "identity": row.identity,
        "sid": "current-session",
        "metadata": dumps_str({"jti": "current"}),
    }
    await LiveKitWebhookProvider().process(_event(call, row, "participant_joined", "old"))
    livekit.remove_participant.assert_not_awaited()


async def test_join_eviction_does_not_remove_replacement_media_session(
    session, access, livekit, call_publication
):
    call = await _call(session, access)
    row = await _participant(session, call, access.admin_id)
    row.token_jti = row.session_jti = "current"
    await session.commit()
    livekit.get_participant.side_effect = [
        {"sid": "old", "metadata": dumps_str({"jti": "revoked"})},
        {"sid": "replacement", "metadata": dumps_str({"jti": "current"})},
    ]
    await LiveKitWebhookProvider().process(_event(call, row, "participant_joined", "revoked"))
    livekit.remove_participant.assert_not_awaited()


@pytest.mark.parametrize("ended", [False, True])
async def test_unadmitted_join_is_evicted_without_changing_other_call(
    session, access, livekit, call_publication, ended
):
    call = await _call(session, access)
    other = await _call(session, access, org_id=access.other_org_id, host_id=access.outsider_id)
    row = await _participant(session, call, access.admin_id)
    if ended:
        await CallOperations(session).end_call_internal(call, CallEndReason.HOST_ENDED)
    else:
        await CallOperations(session).mark_participant_left(call, row)
    livekit.get_participant.return_value = {"sid": "intruder", "metadata": dumps_str({"jti": "old"})}
    await LiveKitWebhookProvider().process(_event(call, row, "participant_joined", "old"))
    livekit.remove_participant.assert_awaited_once_with(call.livekit_room_name, row.identity)
    await session.refresh(other)
    assert other.ended_at is None
