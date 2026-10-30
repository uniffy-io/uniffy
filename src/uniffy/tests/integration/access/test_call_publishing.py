from datetime import UTC, datetime
from enum import StrEnum

import jwt
import pytest
from sqlalchemy import select, update

from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.json_codec import dumps_str
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.calls import Call, CallParticipant, CallType
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.types import generate_id
from uniffy.domains.calls.livekit import LiveKitApiError
from uniffy.domains.calls.operations import CallOperations
from uniffy.domains.calls.policy import ResolvedCallPolicy, save_call_policy
from uniffy.domains.calls.publishing import CallPublishing, can_publish
from uniffy.domains.chat.calls import CALL_UPDATED
from uniffy.tests.integration.access.call_contention import contend
from uniffy.tests.integration.access.calls import _auth_session, _call, _channel, _participant
from uniffy.tests.integration.access.calls import call_publication as call_publication
from uniffy.tests.integration.access.calls import livekit as livekit

pytestmark = pytest.mark.asyncio(loop_scope="session")


class Denial(StrEnum):
    MEMBER = "member"
    FOREIGN_ORG = "foreign_org"
    DISABLED = "disabled"
    OTHER_CHANNEL = "other_channel"
    DIRECT = "direct"


async def setup_call(session, access, *, town_hall=True):
    call = await _call(session, access, town_hall=town_hall)
    await session.execute(
        update(ChatChannel)
        .where(ChatChannel.id == call.channel_id)
        .values(channel_type=ChannelType.PUBLIC)
    )
    auth = await _auth_session(session, access.member_id, access.org_id)
    devices = [
        await _participant(session, call, access.member_id, device=device, auth_session_id=auth.id)
        for device in ("web", "phone")
    ]
    for row in devices:
        row.token_jti = generate_id().hex
        row.hand_raised_at = datetime.now(UTC)
        row.hand_revision = 1
        row.mic_enabled = row.camera_enabled = row.screen_sharing = not town_hall
    await session.commit()
    return call, devices, auth


def live_entries(devices, allowed):
    return [
        {
            "identity": row.identity,
            "metadata": dumps_str({"jti": row.token_jti}),
            "permission": {"canPublish": allowed},
        }
        for row in devices
    ]


async def test_speaker_roles_control_every_device_without_enabling_media(
    session, access, livekit, call_publication
):
    call, devices, _ = await setup_call(session, access)
    livekit.list_participants.return_value = live_entries(devices, True)
    call.speaker_user_ids = [str(access.member_id)]
    for row in devices:
        row.mic_enabled = row.camera_enabled = row.screen_sharing = True
    await session.commit()
    ops = CallPublishing(session)
    await ops.set_speaker(access.owner_id, access.org_id, call.id, access.member_id, speaker=False)
    assert call.town_hall and call.publishing_revision == 1
    assert can_publish(call, access.owner_id)
    assert not can_publish(call, access.member_id)
    assert livekit.set_publishing.await_count == 2
    for row in devices:
        await session.refresh(row)
        assert not (row.mic_enabled or row.camera_enabled or row.screen_sharing)
        livekit.set_publishing.assert_any_await(call.livekit_room_name, row.identity, allowed=False)
    recipients, kind, payload = call_publication.await_args.args
    assert access.member_id in recipients
    assert kind == CALL_UPDATED
    assert payload["call"]["town_hall"] is True
    livekit.list_participants.return_value = live_entries(devices, False)
    await ops.set_speaker(access.owner_id, access.org_id, call.id, access.member_id, speaker=True)
    assert can_publish(call, access.member_id)
    for row in devices:
        await session.refresh(row)
        assert row.hand_raised_at is None and row.hand_revision == 2
        assert not (row.mic_enabled or row.camera_enabled or row.screen_sharing)
        livekit.set_publishing.assert_any_await(call.livekit_room_name, row.identity, allowed=True)
    livekit.list_participants.return_value = live_entries(devices, True)
    await ops.set_speaker(access.owner_id, access.org_id, call.id, access.member_id, speaker=False)
    assert not can_publish(call, access.member_id)
    assert call.speaker_user_ids == [] and call.publishing_revision == 3
    assert (
        len(
            (
                await session.scalars(
                    select(AuditEvent).where(
                        AuditEvent.resource_id == call.id,
                        AuditEvent.action == Action.CALL_PUBLISHING_CHANGED,
                    )
                )
            ).all()
        )
        == 3
    )


async def test_audience_token_rejoin_and_media_report_follow_persisted_role(
    session, access, livekit, call_publication
):
    call, devices, auth = await setup_call(session, access)
    publishing = CallPublishing(session)
    operations = CallOperations(session)
    _, _, token = await operations.join_call(
        access.member_id, access.org_id, call.id, "web", auth_session_id=auth.id
    )
    assert (
        jwt.decode(token.token, options={"verify_signature": False})["video"]["canPublish"] is False
    )
    await operations.update_media_state(
        access.member_id,
        access.org_id,
        call.id,
        "web",
        mic_enabled=True,
        camera_enabled=True,
        screen_sharing=True,
    )
    await session.refresh(devices[0])
    assert not (devices[0].mic_enabled or devices[0].camera_enabled or devices[0].screen_sharing)
    await publishing.set_speaker(
        access.owner_id, access.org_id, call.id, access.member_id, speaker=True
    )
    _, _, token = await operations.join_call(
        access.member_id, access.org_id, call.id, "phone", auth_session_id=auth.id
    )
    assert (
        jwt.decode(token.token, options={"verify_signature": False})["video"]["canPublish"] is True
    )


@pytest.mark.parametrize(
    "denial",
    [Denial.MEMBER, Denial.FOREIGN_ORG, Denial.DISABLED, Denial.OTHER_CHANNEL, Denial.DIRECT],
)
async def test_mode_change_is_rejected_for_every_channel_policy(
    session, access, livekit, call_publication, denial
):
    call, _, _ = await setup_call(session, access, town_hall=False)
    if denial in (Denial.DISABLED, Denial.OTHER_CHANNEL):
        await save_call_policy(
            session,
            policy=ResolvedCallPolicy(
                organization_id=access.org_id,
                town_hall_enabled=denial != Denial.DISABLED,
                town_hall_channel_ids=(str(generate_id()),)
                if denial == Denial.OTHER_CHANNEL
                else (),
            ),
            updated_by_user_id=access.owner_id,
        )
    if denial == Denial.DIRECT:
        call.call_type = CallType.DIRECT
    await session.commit()
    call_id = call.id
    with pytest.raises((PermissionDeniedError, NotFoundError, ValidationError)):
        await CallPublishing(session).set_mode(
            access.member_id if denial == Denial.MEMBER else access.owner_id,
            generate_id() if denial == Denial.FOREIGN_ORG else access.org_id,
            call_id,
            town_hall=True,
        )
    await session.rollback()
    assert not (await session.get(Call, call_id)).town_hall
    livekit.set_publishing.assert_not_awaited()
    call_publication.assert_not_awaited()


async def test_grants_require_town_hall_active_target_and_moderator(
    session, access, livekit, call_publication
):
    call, _, _ = await setup_call(session, access, town_hall=False)
    ops = CallPublishing(session)
    with pytest.raises(ValidationError):
        await ops.set_speaker(
            access.owner_id, access.org_id, call.id, access.member_id, speaker=True
        )
    call, _, _ = await setup_call(session, access)
    with pytest.raises(PermissionDeniedError):
        await ops.set_speaker(
            access.member_id, access.org_id, call.id, access.member_id, speaker=True
        )
    with pytest.raises(ValidationError):
        await ops.set_speaker(
            access.owner_id, access.org_id, call.id, access.owner_id, speaker=False
        )
    with pytest.raises(NotFoundError):
        await ops.set_speaker(access.owner_id, access.org_id, call.id, generate_id(), speaker=True)


async def test_failed_media_update_reconciles_from_committed_policy(
    session, access, livekit, call_publication
):
    call, devices, _ = await setup_call(session, access)
    call.speaker_user_ids = [str(access.member_id)]
    await session.commit()
    livekit.list_participants.return_value = live_entries(devices, True)
    livekit.set_publishing.side_effect = LiveKitApiError("offline", status_code=503)
    with pytest.raises(LiveKitApiError):
        await CallPublishing(session).set_speaker(
            access.owner_id, access.org_id, call.id, access.member_id, speaker=False
        )
    await session.refresh(call)
    assert not can_publish(call, access.member_id)
    livekit.set_publishing.side_effect = None
    livekit.set_publishing.reset_mock()
    await CallPublishing(session).sync(call.id)
    assert livekit.set_publishing.await_count == 2


async def test_competing_speaker_updates_publish_current_policy(
    session, access, livekit, call_publication
):
    call, _, _ = await setup_call(session, access)
    results = await contend(
        select(Call).where(Call.id == call.id).with_for_update(),
        [
            lambda s: CallPublishing(s).set_speaker(
                access.owner_id, access.org_id, call.id, access.member_id, speaker=True
            ),
            lambda s: CallPublishing(s).set_speaker(
                access.owner_id, access.org_id, call.id, access.member_id, speaker=False
            ),
        ],
    )
    assert not any(isinstance(r, Exception) for r in results)
    await session.refresh(call)
    last = call_publication.await_args.args[2]["call"]
    assert last["speaker_user_ids"] == call.speaker_user_ids
    assert last["publishing_revision"] == call.publishing_revision


async def test_join_webhook_corrects_replayed_speaker_permissions(
    session, access, livekit, call_publication
):
    from uniffy.domains.calls.webhook import LiveKitWebhookProvider

    call, devices, _ = await setup_call(session, access)
    stale = live_entries(devices[:1], True)[0]
    stale["sid"] = "reconnected"
    livekit.get_participant.return_value = stale
    livekit.list_participants.return_value = [stale]
    livekit.set_publishing.reset_mock()
    await LiveKitWebhookProvider().process({
        "event": "participant_joined",
        "room": {"name": call.livekit_room_name},
        "participant": stale,
    })
    livekit.set_publishing.assert_awaited_once_with(
        call.livekit_room_name, devices[0].identity, allowed=False
    )
    livekit.remove_participant.assert_not_awaited()


async def test_departing_host_hands_speaking_permission_to_successor(
    session, access, livekit, call_publication
):
    call, devices, _ = await setup_call(session, access)
    livekit.list_participants.return_value = live_entries(devices, False)
    await session.execute(
        update(CallParticipant)
        .where(CallParticipant.call_id == call.id, CallParticipant.user_id == access.owner_id)
        .values(left_at=datetime.now(UTC))
    )
    await session.commit()
    await CallOperations(session).reassign_host_if_absent(call)
    await session.refresh(call)
    assert call.host_user_id == access.member_id and call.publishing_revision == 1
    for row in devices:
        livekit.set_publishing.assert_any_await(call.livekit_room_name, row.identity, allowed=True)
        await session.refresh(row)
        assert not row.mic_enabled
    assert call_publication.await_args.args[2]["call"]["host_user_id"] == str(access.member_id)


async def test_policy_update_preserves_town_hall_fields_for_older_clients(session, access, livekit):
    from uniffy.core.models.calls import ScreenShareQuality

    call, _, _ = await setup_call(session, access)
    values = dict(
        calls_enabled=True,
        max_participants=50,
        max_duration_minutes=60,
        max_screen_share_quality_direct=ScreenShareQuality.UNSPECIFIED,
        max_screen_share_quality_group=ScreenShareQuality.UNSPECIFIED,
        max_screen_share_quality_channel=ScreenShareQuality.UNSPECIFIED,
    )
    ops = CallOperations(session)
    await ops.update_org_policy(
        access.owner_id,
        access.org_id,
        **values,
        town_hall_enabled=False,
        town_hall_channel_ids=(str(call.channel_id),),
    )
    policy = await ops.update_org_policy(access.owner_id, access.org_id, **values)
    assert not policy.town_hall_enabled
    assert policy.town_hall_channel_ids == (str(call.channel_id),)
    with pytest.raises(ValidationError):
        await ops.update_org_policy(
            access.owner_id,
            access.org_id,
            **values,
            town_hall_enabled=True,
            town_hall_channel_ids=(str(generate_id()),),
        )


async def test_removed_member_cannot_be_promoted_from_stale_participant_row(
    session, access, livekit, call_publication
):
    from uniffy.core.models.login.organization_member import OrganizationMember

    call, _, _ = await setup_call(session, access)
    await session.execute(
        update(OrganizationMember)
        .where(
            OrganizationMember.organization_id == access.org_id,
            OrganizationMember.user_id == access.member_id,
        )
        .values(is_active=False)
    )
    await session.commit()
    with pytest.raises(PermissionDeniedError):
        await CallPublishing(session).set_speaker(
            access.owner_id, access.org_id, call.id, access.member_id, speaker=True
        )
    assert not can_publish(call, access.member_id)


@pytest.mark.parametrize("town_hall", [False, True])
async def test_call_mode_is_fixed_at_start(session, access, livekit, call_publication, town_hall):
    actor, org_id = access.owner_id, access.org_id
    channel = await _channel(session, org_id, actor, ChannelType.PUBLIC)
    auth = await _auth_session(session, actor, org_id)
    call, _, _, _ = await CallOperations(session).initiate_call(
        actor, org_id, channel.id, "web", auth_session_id=auth.id, town_hall=town_hall
    )
    assert call.town_hall == town_hall
    call_id = call.id
    call_publication.reset_mock()
    livekit.set_publishing.reset_mock()
    ops = CallPublishing(session)
    with pytest.raises(ValidationError, match="Call mode cannot change"):
        await ops.set_mode(actor, org_id, call_id, town_hall=not town_hall)
    await session.rollback()
    persisted = await session.get(Call, call_id)
    assert persisted.town_hall == town_hall
    assert persisted.publishing_revision == 0
    unchanged = await CallPublishing(session).set_mode(actor, org_id, call_id, town_hall=town_hall)
    assert unchanged.town_hall == town_hall
    assert (
        await session.scalar(
            select(AuditEvent.id).where(
                AuditEvent.resource_id == call_id,
                AuditEvent.action == Action.CALL_PUBLISHING_CHANGED,
            )
        )
        is None
    )
    livekit.set_publishing.assert_not_awaited()
    call_publication.assert_not_awaited()


@pytest.mark.parametrize("denial", [Denial.DISABLED, Denial.OTHER_CHANNEL, Denial.DIRECT])
async def test_town_hall_creation_respects_channel_policy(
    session, access, livekit, call_publication, denial
):
    channel = await _channel(
        session,
        access.org_id,
        access.owner_id,
        ChannelType.DIRECT if denial == Denial.DIRECT else ChannelType.PUBLIC,
    )
    auth = await _auth_session(session, access.owner_id, access.org_id)
    await save_call_policy(
        session,
        policy=ResolvedCallPolicy(
            organization_id=access.org_id,
            town_hall_enabled=denial != Denial.DISABLED,
            town_hall_channel_ids=(str(generate_id()),) if denial == Denial.OTHER_CHANNEL else (),
        ),
        updated_by_user_id=access.owner_id,
    )
    await session.commit()
    with pytest.raises(PermissionDeniedError):
        await CallOperations(session).initiate_call(
            access.owner_id,
            access.org_id,
            channel.id,
            "web",
            auth_session_id=auth.id,
            town_hall=True,
        )
    assert await session.scalar(select(Call.id).where(Call.channel_id == channel.id)) is None
    livekit.create_room.assert_not_awaited()
