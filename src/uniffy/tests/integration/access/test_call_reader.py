from datetime import UTC, datetime
from unittest.mock import AsyncMock, Mock

import pytest
from sqlalchemy import update
from uniffy_proto.calls.v1.calls_pb import CallAvailability

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.calls import CallEndReason
from uniffy.core.models.chat.channel_member import ChannelRole, ChatChannelMember
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.types import SubjectType
from uniffy.domains.calls import reader as reader_module
from uniffy.domains.calls.config import LiveKitConfigError
from uniffy.domains.calls.livekit import LiveKitUnavailableError
from uniffy.domains.calls.policy import ResolvedCallPolicy, save_call_policy
from uniffy.domains.calls.reader import CallReader, probe_call_media
from uniffy.tests.integration.access.calls import _call

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_call_state_keeps_channel_access_and_reports_moderators(session, access):
    call = await _call(session, access)
    reader = CallReader(session)
    assert (await reader.get_state(access.owner_id, access.org_id, call.id))[1]
    assert (await reader.get_state(access.admin_id, access.org_id, call.id))[1]
    with pytest.raises(PermissionDeniedError):
        await reader.get_state(access.member_id, access.org_id, call.id)
    with pytest.raises(NotFoundError):
        await reader.get_state(access.outsider_id, access.other_org_id, call.id)

    session.add(
        ChatChannelMember(
            channel_id=call.channel_id,
            subject_type=SubjectType.USER,
            subject_id=access.member_id,
            user_id=access.member_id,
            role=ChannelRole.MEMBER,
        )
    )
    await session.commit()
    assert not (await CallReader(session).get_state(access.member_id, access.org_id, call.id))[1]
    await session.execute(
        update(ChatChannelMember)
        .where(
            ChatChannelMember.channel_id == call.channel_id,
            ChatChannelMember.user_id == access.member_id,
        )
        .values(role=ChannelRole.ADMIN)
    )
    await session.commit()
    assert (await CallReader(session).get_state(access.member_id, access.org_id, call.id))[1]


async def test_ended_call_state_works_without_media_config(session, access, monkeypatch):
    call = await _call(session, access)
    call.ended_at = datetime.now(UTC)
    call.end_reason = CallEndReason.MAX_DURATION
    session.add(call)
    await session.commit()
    monkeypatch.setattr(reader_module, "get_livekit_config", Mock(side_effect=LiveKitConfigError()))
    found, _ = await CallReader(session).get_state(access.owner_id, access.org_id, call.id)
    assert found.end_reason == CallEndReason.MAX_DURATION


async def test_call_reader_rejects_deactivated_host(session, access):
    call = await _call(session, access)
    await session.execute(
        update(OrganizationMember)
        .where(
            OrganizationMember.organization_id == access.org_id,
            OrganizationMember.user_id == access.owner_id,
        )
        .values(is_active=False)
    )
    await session.commit()
    with pytest.raises(PermissionDeniedError):
        await CallReader(session).get_state(access.owner_id, access.org_id, call.id)
    with pytest.raises(PermissionDeniedError):
        await CallReader(session).availability(access.owner_id, access.org_id)


async def test_availability_distinguishes_policy_from_configuration(session, access, monkeypatch):
    monkeypatch.setattr(reader_module, "get_livekit_config", lambda: None)
    monkeypatch.setattr(reader_module, "get_turn_config", lambda: None)
    assert (
        await CallReader(session).availability(access.member_id, access.org_id)
        == CallAvailability.READY
    )

    def unconfigured():
        raise LiveKitConfigError()

    monkeypatch.setattr(reader_module, "get_livekit_config", unconfigured)
    assert (
        await CallReader(session).availability(access.member_id, access.org_id)
        == CallAvailability.NOT_CONFIGURED
    )
    await save_call_policy(
        session,
        policy=ResolvedCallPolicy(organization_id=access.org_id, calls_enabled=False),
        updated_by_user_id=access.owner_id,
    )
    await session.commit()
    assert (
        await CallReader(session).availability(access.member_id, access.org_id)
        == CallAvailability.DISABLED
    )
    with pytest.raises(PermissionDeniedError):
        await CallReader(session).availability(access.outsider_id, access.org_id)


async def test_media_probe_filters_rooms_and_handles_outage(monkeypatch):
    client = AsyncMock()
    monkeypatch.setattr(reader_module, "get_livekit_admin_client", lambda: client)
    assert await probe_call_media() == CallAvailability.READY
    client.list_rooms.assert_awaited_once_with(names=["uniffy-health-check"])
    client.list_rooms.side_effect = LiveKitUnavailableError("offline")
    assert await probe_call_media() == CallAvailability.UNREACHABLE
