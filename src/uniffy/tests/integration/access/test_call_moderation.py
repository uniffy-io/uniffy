from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select, update

from uniffy.core.audit.actions import Action
from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.chat.channel_member import ChannelRole, ChatChannelMember
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.types import SubjectType
from uniffy.domains.calls.operations import CallOperations
from uniffy.tests.integration.access.calls import _call, _participant
from uniffy.tests.integration.access.calls import livekit as livekit

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest.mark.parametrize("operation", ["mute_participant", "kick_participant", "end_call"])
@pytest.mark.parametrize("actor", ["member", "deactivated_host"])
async def test_moderation_requires_active_authority(session, access, livekit, operation, actor):
    call = await _call(session, access)
    participant = await _participant(session, call, access.member_id)
    user_id = access.member_id
    session.add(
        ChatChannelMember(
            channel_id=call.channel_id,
            subject_type=SubjectType.USER,
            subject_id=user_id,
            user_id=user_id,
            role=ChannelRole.MEMBER,
        )
    )
    if actor == "deactivated_host":
        user_id = access.owner_id
        await session.execute(
            update(OrganizationMember)
            .where(
                OrganizationMember.organization_id == access.org_id,
                OrganizationMember.user_id == user_id,
            )
            .values(is_active=False)
        )
    await session.commit()
    ops = CallOperations(session)
    args = [user_id, access.org_id, call.id]
    if operation != "end_call":
        args.append(participant.identity)
    with pytest.raises(PermissionDeniedError):
        await getattr(ops, operation)(*args)
    livekit.remove_participant.assert_not_awaited()
    livekit.delete_room.assert_not_awaited()
    assert not livekit.mute_participant_microphone.called


@pytest.mark.parametrize("actor", ["host", "org_admin", "channel_admin"])
async def test_mute_notifies_even_after_client_reported_muted(
    session, access, livekit, monkeypatch, actor
):
    call = await _call(session, access)
    participant = await _participant(session, call, access.member_id)
    participant.mic_enabled = False
    session.add(participant)
    user_id = access.owner_id if actor == "host" else access.admin_id
    if actor == "channel_admin":
        user_id = access.member_id
        session.add(
            ChatChannelMember(
                channel_id=call.channel_id,
                subject_type=SubjectType.USER,
                subject_id=user_id,
                user_id=user_id,
                role=ChannelRole.ADMIN,
            )
        )
    await session.commit()
    livekit.mute_participant_microphone = AsyncMock(return_value=True)
    publish = AsyncMock()
    monkeypatch.setattr(CallOperations, "publish_participant_state", publish)
    await CallOperations(session).mute_participant(
        user_id, access.org_id, call.id, participant.identity
    )
    livekit.mute_participant_microphone.assert_awaited_once_with(
        call.livekit_room_name, participant.identity
    )
    publish.assert_awaited_once_with(call, participant, moderator_muted=True)
    audit = await session.scalar(
        select(AuditEvent).where(
            AuditEvent.resource_id == call.id, AuditEvent.action == Action.CALL_PARTICIPANT_MUTED
        )
    )
    assert audit is not None
    assert audit.actor_user_id == user_id
