from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select, update

from uniffy.core.json_codec import dumps_str
from uniffy.core.models.calls import Call, CallEndReason, CallParticipant
from uniffy.core.types import generate_id
from uniffy.domains.calls import operations
from uniffy.domains.calls.config import get_livekit_config
from uniffy.domains.calls.jobs import jobs
from uniffy.domains.calls.livekit import LiveKitAdminClient, LiveKitApiError
from uniffy.domains.calls.policy import ResolvedCallPolicy, save_call_policy
from uniffy.domains.calls.tokens import livekit_room_name
from uniffy.tests.integration.access.calls import _call, _participant
from uniffy.tests.integration.access.calls import call_publication as call_publication
from uniffy.tests.integration.access.calls import livekit as livekit
from uniffy.tests.integration.access.calls import scoped_reconciler as scoped_reconciler

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_missing_participants_need_two_passes_and_join_grace(
    session, access, livekit, scoped_reconciler, call_publication
):
    call = await _call(session, access)
    fresh = await _participant(session, call, access.admin_id)
    first = await jobs.reconcile_calls({})
    assert first["status"] == "success"
    assert first["ghost_participants"] == 0
    assert (
        await session.scalar(
            select(CallParticipant.missing_since).where(CallParticipant.id == fresh.id)
        )
        is None
    )

    await session.execute(
        update(CallParticipant)
        .where(CallParticipant.call_id == call.id)
        .values(joined_at=datetime.now(UTC) - timedelta(minutes=2))
    )
    await session.commit()
    second = await jobs.reconcile_calls({})
    assert second["ghost_participants"] == 0
    rows = (
        await session.scalars(
            select(CallParticipant)
            .where(CallParticipant.call_id == call.id)
            .execution_options(populate_existing=True)
        )
    ).all()
    assert all(row.left_at is None and row.missing_since is not None for row in rows)
    third = await jobs.reconcile_calls({})
    assert third["ghost_participants"] == 0
    await session.execute(
        update(CallParticipant)
        .where(CallParticipant.call_id == call.id)
        .values(missing_since=datetime.now(UTC) - timedelta(minutes=2))
    )
    await session.commit()
    fourth = await jobs.reconcile_calls({})
    assert fourth["ghost_participants"] == 2
    assert fourth["ended"] == 1
    await session.refresh(call)
    assert call.end_reason == CallEndReason.ALL_LEFT
    livekit.delete_room.assert_awaited_once_with(call.livekit_room_name)


async def test_live_participant_clears_absence_without_evicting_refreshed_session(
    session, access, livekit, scoped_reconciler, call_publication
):
    call = await _call(session, access)
    await session.execute(
        update(CallParticipant)
        .where(CallParticipant.call_id == call.id)
        .values(
            joined_at=datetime.now(UTC) - timedelta(minutes=2),
            missing_since=datetime.now(UTC) - timedelta(minutes=2),
            token_jti="refreshed",
            session_jti="connected",
        )
    )
    await session.commit()
    livekit.list_participants.return_value = [
        {"identity": f"{access.owner_id}:host", "metadata": dumps_str({"jti": "connected"})}
    ]
    result = await jobs.reconcile_calls({})
    assert result["ghost_participants"] == 0
    row = (
        await session.scalars(select(CallParticipant).where(CallParticipant.call_id == call.id))
    ).one()
    assert row.missing_since is None and row.left_at is None
    livekit.remove_participant.assert_not_awaited()


@pytest.mark.parametrize(
    "case,reason",
    [
        ("duration", CallEndReason.MAX_DURATION),
        ("empty", CallEndReason.ALL_LEFT),
        ("solo", CallEndReason.SOLO_TIMEOUT),
    ],
)
async def test_reconciler_enforces_duration_empty_and_solo_policy(
    session, access, livekit, scoped_reconciler, call_publication, case, reason
):
    call = await _call(session, access)
    call.started_at = datetime.now(UTC) - timedelta(minutes=11)
    if case == "duration":
        await save_call_policy(
            session,
            policy=ResolvedCallPolicy(organization_id=access.org_id, max_duration_minutes=10),
            updated_by_user_id=access.owner_id,
        )
    if case == "empty":
        await session.execute(
            update(CallParticipant)
            .where(CallParticipant.call_id == call.id)
            .values(left_at=datetime.now(UTC))
        )
    await session.commit()
    result = await jobs.reconcile_calls({})
    assert result["status"] == "success"
    assert result["ended"] == 1
    await session.refresh(call)
    assert call.end_reason == reason
    assert (await jobs.reconcile_calls({}))["ended"] == 0
    livekit.delete_room.assert_awaited_once_with(call.livekit_room_name)


async def test_reconciler_preserves_recent_empty_and_recently_solo_calls(
    session, access, livekit, scoped_reconciler, call_publication
):
    empty = await _call(session, access)
    solo = await _call(session, access)
    solo.started_at = datetime.now(UTC) - timedelta(hours=1)
    departed = await _participant(session, solo, access.admin_id)
    departed.left_at = datetime.now(UTC)
    await session.execute(
        update(CallParticipant)
        .where(CallParticipant.call_id == empty.id)
        .values(left_at=datetime.now(UTC))
    )
    await session.commit()
    assert (await jobs.reconcile_calls({}))["ended"] == 0
    livekit.delete_room.assert_not_awaited()


async def test_media_outage_preserves_presence_but_enforces_duration(
    session, access, livekit, scoped_reconciler, call_publication, monkeypatch
):
    live = await _call(session, access)
    expired = await _call(session, access)
    expired.started_at = datetime.now(UTC) - timedelta(hours=9)
    await session.execute(
        update(CallParticipant)
        .where(CallParticipant.call_id == live.id)
        .values(
            joined_at=datetime.now(UTC) - timedelta(minutes=10),
            missing_since=datetime.now(UTC) - timedelta(minutes=2),
        )
    )
    await session.commit()
    client = LiveKitAdminClient(get_livekit_config())
    client._http = SimpleNamespace(post=AsyncMock(return_value=SimpleNamespace(status=503)))
    monkeypatch.setattr(jobs, "get_livekit_admin_client", lambda: client)
    monkeypatch.setattr(operations, "get_livekit_admin_client", lambda: client)
    result = await jobs.reconcile_calls({})
    assert result["status"] == "success"
    assert result["media_reachable"] is False
    assert result["ended"] == 1 and result["ghost_participants"] == 0
    await session.refresh(live)
    await session.refresh(expired)
    assert live.ended_at is None
    assert expired.end_reason == CallEndReason.MAX_DURATION
    assert (
        await session.scalar(
            select(CallParticipant.left_at).where(CallParticipant.call_id == live.id)
        )
        is None
    )
    assert client._http.post.await_count == 1


@pytest.mark.parametrize("status", [404, 403])
async def test_room_lookup_errors_do_not_immediately_retire_participants(
    session, access, livekit, scoped_reconciler, call_publication, status
):
    call = await _call(session, access)
    await session.execute(
        update(CallParticipant)
        .where(CallParticipant.call_id == call.id)
        .values(joined_at=datetime.now(UTC) - timedelta(minutes=2))
    )
    await session.commit()
    livekit.list_participants.side_effect = LiveKitApiError("room lookup failed", status_code=status)
    result = await jobs.reconcile_calls({})
    assert result["status"] == "success" and result["ghost_participants"] == 0
    row = (
        await session.scalars(select(CallParticipant).where(CallParticipant.call_id == call.id))
    ).one()
    assert row.left_at is None
    assert (row.missing_since is not None) == (status == 404)


async def test_reconciler_evicts_unadmitted_media_identity(
    session, access, livekit, scoped_reconciler, call_publication
):
    call = await _call(session, access)
    unknown = {
        "identity": f"{access.member_id}:unknown",
        "sid": "unknown",
        "metadata": dumps_str({"jti": "stolen"}),
    }
    livekit.list_participants.return_value = [unknown]
    livekit.get_participant.return_value = unknown
    result = await jobs.reconcile_calls({})
    assert result["status"] == "success"
    livekit.remove_participant.assert_awaited_once_with(call.livekit_room_name, unknown["identity"])


async def test_orphan_cleanup_removes_only_missing_or_ended_canonical_rooms(
    session, access, livekit, scoped_reconciler, call_publication
):
    active = await _call(session, access)
    ended = await _call(session, access)
    ended.ended_at = datetime.now(UTC)
    await session.commit()
    missing = livekit_room_name(access.org_id, generate_id())
    livekit.list_rooms.return_value = [
        {"name": name}
        for name in (active.livekit_room_name, ended.livekit_room_name, missing, "external-room")
    ]
    result = await jobs.cleanup_orphan_call_rooms({})
    assert result == {"status": "success", "closed": 2}
    assert {c.args[0] for c in livekit.delete_room.await_args_list} == {
        ended.livekit_room_name,
        missing,
    }
