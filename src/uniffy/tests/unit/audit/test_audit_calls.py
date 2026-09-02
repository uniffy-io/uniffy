"""Call lifecycle and moderation audit emissions.

Join/leave stay unaudited - calls_participants is the attendance record.
The audit log carries lifecycle (started/ended) and moderation (kick/mute).
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.audit.actions import Action
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.calls import Call, CallEndReason, CallParticipant, CallType
from uniffy.core.types import generate_id


def _audit_rows(session: MagicMock) -> list:
    return [
        call.args[0]
        for call in session.add.call_args_list
        if call.args and isinstance(call.args[0], AuditEvent)
    ]


def _build_session() -> MagicMock:
    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    session.delete = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=object())  # CAS-win sentinel
    result.all = MagicMock(return_value=[])
    session.execute = AsyncMock(return_value=result)
    return session


def _build_ops(session: MagicMock):
    from uniffy.domains.calls.config import LiveKitConfig
    from uniffy.domains.calls.operations import CallOperations

    with patch(
        "uniffy.domains.calls.operations.get_livekit_config",
        return_value=LiveKitConfig(
            host="http://livekit:7880", api_key="k", api_secret="s" * 32, ws_url="/livekit"
        ),
    ):
        return CallOperations(session)


def _call(org_id, channel_id, host_id, started_minutes_ago: int = 10) -> Call:
    return Call(
        id=generate_id(),
        organization_id=org_id,
        channel_id=channel_id,
        call_type=CallType.CHANNEL,
        initiator_user_id=host_id,
        host_user_id=host_id,
        livekit_room_name=f"org_{org_id}:call_{generate_id()}",
        started_at=datetime.now(UTC) - timedelta(minutes=started_minutes_ago),
    )


def _participant(call: Call, user_id) -> CallParticipant:
    return CallParticipant(
        id=generate_id(),
        call_id=call.id,
        organization_id=call.organization_id,
        user_id=user_id,
        device_id="d1",
        identity=f"{user_id}:d1",
        token_jti="jti-1",
        joined_at=datetime.now(UTC),
    )


async def test_end_call_internal_emits_call_ended_with_reason_and_actor() -> None:
    org_id, channel_id, host_id = generate_id(), generate_id(), generate_id()
    call = _call(org_id, channel_id, host_id)
    session = _build_session()
    ops = _build_ops(session)

    with (
        patch.object(type(ops), "list_active_participants", AsyncMock(return_value=[])),
        patch.object(type(ops), "member_user_ids", AsyncMock(return_value=[])),
        patch.object(ops.chat, "publish", AsyncMock()),
        patch("uniffy.domains.calls.operations.get_livekit_admin_client") as client_factory,
    ):
        client_factory.return_value.delete_room = AsyncMock()
        await ops.end_call_internal(call, CallEndReason.HOST_ENDED, actor_user_id=host_id)

    rows = _audit_rows(session)
    ended = [r for r in rows if r.action == Action.CALL_ENDED]
    assert len(ended) == 1
    assert ended[0].actor_user_id == host_id
    assert ended[0].resource_id == call.id
    assert ended[0].details["reason"] == CallEndReason.HOST_ENDED.value
    assert ended[0].details["channel_id"] == str(channel_id)
    assert ended[0].details["duration_seconds"] >= 9 * 60


async def test_system_end_emits_call_ended_without_actor() -> None:
    call = _call(generate_id(), generate_id(), generate_id())
    session = _build_session()
    ops = _build_ops(session)

    with (
        patch.object(type(ops), "list_active_participants", AsyncMock(return_value=[])),
        patch.object(type(ops), "member_user_ids", AsyncMock(return_value=[])),
        patch.object(ops.chat, "publish", AsyncMock()),
        patch("uniffy.domains.calls.operations.get_livekit_admin_client") as client_factory,
    ):
        client_factory.return_value.delete_room = AsyncMock()
        await ops.end_call_internal(call, CallEndReason.MAX_DURATION)

    ended = [r for r in _audit_rows(session) if r.action == Action.CALL_ENDED]
    assert len(ended) == 1
    assert ended[0].actor_user_id is None
    assert ended[0].details["reason"] == CallEndReason.MAX_DURATION.value


async def test_kick_emits_participant_kicked_with_target() -> None:
    org_id, channel_id, host_id, target_id = (
        generate_id(),
        generate_id(),
        generate_id(),
        generate_id(),
    )
    call = _call(org_id, channel_id, host_id)
    participant = _participant(call, target_id)
    session = _build_session()
    ops = _build_ops(session)

    with (
        patch.object(type(ops), "_get_call", AsyncMock(return_value=call)),
        patch.object(type(ops), "get_active_participant", AsyncMock(return_value=participant)),
        patch.object(type(ops), "mark_participant_left", AsyncMock()),
        patch("uniffy.domains.calls.operations.get_livekit_admin_client") as client_factory,
    ):
        client_factory.return_value.remove_participant = AsyncMock()
        await ops.kick_participant(host_id, org_id, call.id, participant.identity)

    kicked = [r for r in _audit_rows(session) if r.action == Action.CALL_PARTICIPANT_KICKED]
    assert len(kicked) == 1
    assert kicked[0].actor_user_id == host_id
    assert kicked[0].details["target_user_id"] == str(target_id)
    assert kicked[0].details["target_identity"] == participant.identity


async def test_mute_emits_participant_muted() -> None:
    org_id, channel_id, host_id, target_id = (
        generate_id(),
        generate_id(),
        generate_id(),
        generate_id(),
    )
    call = _call(org_id, channel_id, host_id)
    participant = _participant(call, target_id)
    participant.mic_enabled = True
    session = _build_session()
    ops = _build_ops(session)

    with (
        patch.object(type(ops), "_get_call", AsyncMock(return_value=call)),
        patch.object(type(ops), "get_active_participant", AsyncMock(return_value=participant)),
        patch.object(type(ops), "publish_participant_state", AsyncMock()),
        patch("uniffy.domains.calls.operations.get_livekit_admin_client") as client_factory,
    ):
        client_factory.return_value.mute_participant_microphone = AsyncMock(return_value=True)
        await ops.mute_participant(host_id, org_id, call.id, participant.identity)

    muted = [r for r in _audit_rows(session) if r.action == Action.CALL_PARTICIPANT_MUTED]
    assert len(muted) == 1
    assert muted[0].actor_user_id == host_id
    assert muted[0].details["target_user_id"] == str(target_id)
    assert participant.mic_enabled is False


async def test_join_and_leave_do_not_audit() -> None:
    """mark_participant_left (RPC leave / webhook path) emits no audit row."""
    call = _call(generate_id(), generate_id(), generate_id())
    participant = _participant(call, generate_id())
    session = _build_session()
    ops = _build_ops(session)

    with (
        patch.object(type(ops), "list_active_participants", AsyncMock(return_value=[participant])),
        patch.object(type(ops), "member_user_ids", AsyncMock(return_value=[])),
        patch.object(type(ops), "resolve_profiles", AsyncMock(return_value={})),
        patch.object(type(ops), "reassign_host_if_absent", AsyncMock()),
        patch.object(ops.chat, "publish", AsyncMock()),
    ):
        await ops.mark_participant_left(call, participant)

    assert _audit_rows(session) == []
