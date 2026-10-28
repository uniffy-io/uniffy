import jwt
import pytest
from sqlalchemy import select

from uniffy.core.errors import ValidationError
from uniffy.core.models.calls import Call, CallParticipant
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.domains.calls.livekit import LiveKitUnavailableError
from uniffy.domains.calls.operations import CallOperations
from uniffy.domains.calls.policy import ResolvedCallPolicy, save_call_policy
from uniffy.infrastructure.database import open_session
from uniffy.tests.integration.access.call_contention import contend
from uniffy.tests.integration.access.calls import _call, _channel
from uniffy.tests.integration.access.calls import livekit as livekit

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _token_capacity(token) -> int:
    claims = jwt.decode(token.token, "e" * 48, algorithms=["HS256"])
    return claims["roomConfig"]["maxParticipants"]


async def _set_policy(session, access, capacity: int) -> None:
    await save_call_policy(
        session,
        policy=ResolvedCallPolicy(organization_id=access.org_id, max_participants=capacity),
        updated_by_user_id=access.owner_id,
    )
    await session.commit()


async def test_capacity_is_shared_by_admission_media_and_refreshed_tokens(
    session, access, livekit
) -> None:
    await _set_policy(session, access, 75)
    channel = await _channel(session, access.org_id, access.owner_id)
    ops = CallOperations(session)
    call, _, token, _ = await ops.initiate_call(access.owner_id, access.org_id, channel.id, "host")
    assert call.max_participants == 75
    assert _token_capacity(token) == 75
    livekit.create_room.assert_awaited_with(call.livekit_room_name, max_participants=75)

    await _set_policy(session, access, 1)
    _, participants, token = await ops.join_call(access.admin_id, access.org_id, call.id, "admin")
    assert len(participants) == 2
    assert _token_capacity(token) == 75
    refreshed = await ops.refresh_token(access.admin_id, access.org_id, call.id, "admin")
    assert _token_capacity(refreshed) == 75
    livekit.create_room.assert_awaited_with(call.livekit_room_name, max_participants=75)

    await ops.end_call(access.owner_id, access.org_id, call.id)
    replacement, _, token, _ = await ops.initiate_call(
        access.owner_id, access.org_id, channel.id, "host"
    )
    assert replacement.max_participants == 1
    assert _token_capacity(token) == 1
    livekit.create_room.assert_awaited_with(replacement.livekit_room_name, max_participants=1)


async def test_concurrent_joins_cannot_take_same_last_slot(session, access, livekit) -> None:
    call = await _call(session, access)
    call.max_participants = 2
    channel = await session.get(ChatChannel, call.channel_id)
    channel.channel_type = ChannelType.PUBLIC
    await session.commit()

    def join(user_id):
        async def run(other):
            return await CallOperations(other).join_call(user_id, access.org_id, call.id, "browser")

        return run

    results = await contend(
        select(Call).where(Call.id == call.id).with_for_update(),
        [join(access.admin_id), join(access.member_id)],
    )
    assert sum(isinstance(result, tuple) for result in results) == 1
    failures = [result for result in results if isinstance(result, ValidationError)]
    assert len(failures) == 1
    assert "Call is full" in str(failures[0])
    rows = await CallOperations(session).list_active_participants(call.id)
    assert len(rows) == 2

    winner = next(row for row in rows if row.user_id != access.owner_id)
    _, rows, _ = await CallOperations(session).join_call(
        winner.user_id, access.org_id, call.id, "browser"
    )
    assert len(rows) == 2


async def test_room_failure_keeps_committed_admission_retryable(session, access, livekit) -> None:
    call = await _call(session, access)

    async def unavailable(room, *, max_participants):
        async with open_session() as other:
            admitted = await other.scalar(
                select(CallParticipant.id).where(
                    CallParticipant.call_id == call.id,
                    CallParticipant.user_id == access.admin_id,
                    CallParticipant.left_at.is_(None),
                )
            )
            assert admitted is not None
        raise LiveKitUnavailableError("offline")

    livekit.create_room.side_effect = unavailable
    ops = CallOperations(session)
    with pytest.raises(LiveKitUnavailableError):
        await ops.join_call(access.admin_id, access.org_id, call.id, "browser")

    livekit.create_room.side_effect = None
    livekit.create_room.return_value = {"maxParticipants": 50}
    _, participants, token = await ops.join_call(access.admin_id, access.org_id, call.id, "browser")
    assert len(participants) == 2
    assert _token_capacity(token) == 50


async def test_existing_media_capacity_mismatch_has_restart_guidance(
    session, access, livekit
) -> None:
    call = await _call(session, access)
    call.max_participants = 75
    await session.commit()
    livekit.create_room.side_effect = None
    livekit.create_room.return_value = {"max_participants": 50}

    with pytest.raises(ValidationError, match="End this call and start a new one"):
        await CallOperations(session).join_call(access.admin_id, access.org_id, call.id, "browser")
