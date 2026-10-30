from datetime import UTC, datetime, timedelta

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from sqlalchemy import select
from uniffy_proto.calls.v1.calls_pb import DeclineCallRequest

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.calls import Call, CallInvitation, CallParticipant, ScreenShareQuality
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.types import SubjectType
from uniffy.domains.calls.handlers import CallHandlers
from uniffy.domains.calls.operations import CallOperations
from uniffy.tests.integration.access.calls import _call, _participant
from uniffy.tests.integration.access.calls import call_publication as call_publication
from uniffy.tests.integration.access.calls import livekit as livekit
from uniffy.tests.integration.access.rpc_calls import call_rpc

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest.mark.parametrize(
    "actor,other_org,code",
    [
        ("owner_id", False, None),
        ("member_id", False, Code.PERMISSION_DENIED),
        ("ghost_id", False, Code.PERMISSION_DENIED),
        ("outsider_id", True, Code.NOT_FOUND),
    ],
)
async def test_decline_checks_access_without_ending_shared_call(
    session, access, livekit, call_publication, actor, other_org, code
):
    call = await _call(session, access)
    session.add(
        CallInvitation(
            call_id=call.id,
            user_id=access.owner_id,
            organization_id=access.org_id,
            expires_at=datetime.now(UTC) + timedelta(seconds=30),
        )
    )
    await session.commit()
    org_id = access.other_org_id if other_org else access.org_id

    async def decline():
        return await call_rpc(
            CallHandlers().decline_call,
            DeclineCallRequest(organization_id=str(org_id), call_id=str(call.id)),
            user_id=getattr(access, actor),
            organization_id=org_id,
        )

    if code is None:
        assert (await decline()).success
    else:
        with pytest.raises(ConnectError) as error:
            await decline()
        assert error.value.code == code
    await session.refresh(call)
    assert call.ended_at is None
    livekit.delete_room.assert_not_awaited()
    call_publication.assert_not_awaited()


def _operations(ops, call, user_id, org_id, device, target):
    return {
        "start": lambda: ops.initiate_call(user_id, org_id, call.channel_id, device),
        "join": lambda: ops.join_call(user_id, org_id, call.id, device),
        "read": lambda: ops.get_active_call(user_id, org_id, call.channel_id),
        "refresh": lambda: ops.refresh_token(user_id, org_id, call.id, device),
        "end": lambda: ops.end_call(user_id, org_id, call.id),
        "kick": lambda: ops.kick_participant(user_id, org_id, call.id, target.identity),
        "mute": lambda: ops.mute_participant(user_id, org_id, call.id, target.identity),
        "media": lambda: ops.update_media_state(
            user_id,
            org_id,
            call.id,
            device,
            mic_enabled=False,
            camera_enabled=True,
            screen_sharing=True,
        ),
        "leave": lambda: ops.leave_call(user_id, org_id, call.id, device),
    }


@pytest.mark.parametrize(
    "operation", ["start", "join", "read", "refresh", "end", "kick", "mute", "media"]
)
@pytest.mark.parametrize("actor", ["member_id", "ghost_id", "outsider_id"])
async def test_call_operations_reject_inaccessible_channel_and_stale_participant(
    session, access, livekit, call_publication, operation, actor
):
    call = await _call(session, access)
    user_id = getattr(access, actor)
    stale = await _participant(session, call, user_id)
    with pytest.raises(PermissionDeniedError):
        await _operations(
            CallOperations(session), call, user_id, access.org_id, stale.device_id, stale
        )[operation]()
    await session.rollback()
    await session.refresh(stale)
    row = stale
    assert row.left_at is None and row.mic_enabled is True and row.camera_enabled is False
    livekit.create_room.assert_not_awaited()
    livekit.remove_participant.assert_not_awaited()
    livekit.mute_participant_microphone.assert_not_awaited()
    livekit.delete_room.assert_not_awaited()
    call_publication.assert_not_awaited()


@pytest.mark.parametrize(
    "operation", ["start", "join", "read", "refresh", "end", "kick", "mute", "media", "leave"]
)
async def test_call_operations_cannot_address_another_tenants_call(
    session, access, livekit, call_publication, operation
):
    call = await _call(session, access)
    target = await _participant(session, call, access.member_id)
    with pytest.raises(NotFoundError):
        await _operations(
            CallOperations(session), call, access.outsider_id, access.other_org_id, "device", target
        )[operation]()
    assert await session.scalar(select(Call.ended_at).where(Call.id == call.id)) is None
    livekit.create_room.assert_not_awaited()
    livekit.remove_participant.assert_not_awaited()
    livekit.mute_participant_microphone.assert_not_awaited()
    livekit.delete_room.assert_not_awaited()


async def test_active_call_list_filters_stale_private_participation_and_other_tenants(
    session, access, livekit
):
    private = await _call(session, access)
    await _participant(session, private, access.member_id)
    public = await _call(session, access)
    channel = await session.get(ChatChannel, public.channel_id)
    channel.channel_type = ChannelType.PUBLIC
    await _participant(session, public, access.member_id)
    joined = await _call(session, access)
    session.add(
        ChatChannelMember(
            channel_id=joined.channel_id,
            subject_type=SubjectType.USER,
            subject_id=access.member_id,
            user_id=access.member_id,
        )
    )
    await session.commit()
    await _call(session, access, org_id=access.other_org_id, host_id=access.outsider_id)
    found = await CallOperations(session).list_active_calls_for_user(access.member_id, access.org_id)
    assert {call.id for call, _ in found} == {public.id, joined.id}
    for user in (access.ghost_id, access.outsider_id):
        with pytest.raises(PermissionDeniedError):
            await CallOperations(session).list_active_calls_for_user(user, access.org_id)


async def test_leave_and_media_state_only_target_actors_device(
    session, access, livekit, call_publication
):
    call = await _call(session, access)
    owner = (
        await session.scalars(select(CallParticipant).where(CallParticipant.call_id == call.id))
    ).one()
    member = await _participant(session, call, access.member_id, device=owner.device_id)
    session.add(
        ChatChannelMember(
            channel_id=call.channel_id,
            subject_type=SubjectType.USER,
            subject_id=access.member_id,
            user_id=access.member_id,
        )
    )
    await session.commit()
    ops = CallOperations(session)
    await ops.update_media_state(
        access.member_id,
        access.org_id,
        call.id,
        member.device_id,
        mic_enabled=False,
        camera_enabled=True,
        screen_sharing=True,
    )
    await ops.leave_call(access.member_id, access.org_id, call.id, member.device_id)
    await ops.leave_call(access.member_id, access.org_id, call.id, member.device_id)
    await session.refresh(owner)
    await session.refresh(member)
    assert owner.left_at is None and owner.mic_enabled is True and owner.camera_enabled is False
    assert member.left_at is not None


@pytest.mark.parametrize("user", ["member_id", "ghost_id", "outsider_id"])
async def test_call_policy_requires_active_org_admin(session, access, livekit, user):
    ops = CallOperations(session)
    with pytest.raises(PermissionDeniedError):
        await ops.get_org_policy_view(getattr(access, user), access.org_id)
    with pytest.raises(PermissionDeniedError):
        await ops.update_org_policy(
            getattr(access, user),
            access.org_id,
            calls_enabled=False,
            max_participants=10,
            max_duration_minutes=60,
            max_screen_share_quality_direct=ScreenShareQuality.HIGH,
            max_screen_share_quality_group=ScreenShareQuality.HIGH,
            max_screen_share_quality_channel=ScreenShareQuality.HIGH,
        )
