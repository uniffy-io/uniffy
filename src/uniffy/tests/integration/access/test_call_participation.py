from datetime import UTC, datetime
from enum import StrEnum
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select, update
from uniffy_proto.calls.v1.calls_pb import CallReaction

from uniffy.core.errors import (
    NotFoundError,
    PermissionDeniedError,
    RateLimitExceededError,
    ValidationError,
)
from uniffy.core.models.calls import Call, CallParticipant
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.types import generate_id
from uniffy.domains.calls.converters import participant_to_proto
from uniffy.domains.calls.operations import CallOperations
from uniffy.domains.calls.participation import CallParticipation
from uniffy.domains.chat.calls import CALL_REACTION
from uniffy.tests.integration.access.call_contention import contend
from uniffy.tests.integration.access.calls import _auth_session, _call, _participant
from uniffy.tests.integration.access.calls import call_publication as call_publication
from uniffy.tests.integration.access.calls import livekit as livekit

pytestmark = pytest.mark.asyncio(loop_scope="session")


class Denial(StrEnum):
    WRONG_SESSION = "wrong_session"
    NOT_JOINED = "not_joined"
    OTHER_ORG = "other_org"
    OTHER_HAND = "other_hand"
    RAISE_OTHER = "raise_other"


async def participants(session, access):
    call = await _call(session, access)
    await session.execute(
        update(ChatChannel)
        .where(ChatChannel.id == call.channel_id)
        .values(channel_type=ChannelType.PUBLIC)
    )
    auth = await _auth_session(session, access.member_id, access.org_id)
    member = await _participant(session, call, access.member_id, auth_session_id=auth.id)
    host_auth = await _auth_session(session, access.owner_id, access.org_id)
    await session.execute(
        update(CallParticipant)
        .where(CallParticipant.call_id == call.id, CallParticipant.user_id == access.owner_id)
        .values(auth_session_id=host_auth.id)
    )
    await session.commit()
    return call, member, auth, host_auth


async def test_hand_queue_persists_idempotently_and_host_lowers(
    session, access, livekit, call_publication
):
    call, member, auth, host_auth = await participants(session, access)
    ops = CallParticipation(session)
    first = await ops.set_hand(access.member_id, access.org_id, call.id, "d1", auth.id, raised=True)
    timestamp = first.hand_raised_at
    assert timestamp is not None
    assert first.hand_revision == 1
    await ops.set_hand(access.member_id, access.org_id, call.id, "d1", auth.id, raised=True)
    assert first.hand_raised_at == timestamp
    assert first.hand_revision == 1
    await ops.set_hand(access.owner_id, access.org_id, call.id, "host", host_auth.id, raised=True)
    snapshot = await CallOperations(session).list_active_participants(call.id)
    hands = sorted((p for p in snapshot if p.hand_raised_at), key=lambda p: p.hand_raised_at)
    assert hands[0].id == member.id
    assert participant_to_proto(hands[0]).hand_raised_at is not None
    await ops.set_hand(
        access.owner_id,
        access.org_id,
        call.id,
        "host",
        host_auth.id,
        raised=False,
        identity=member.identity,
    )
    await session.refresh(member)
    assert member.hand_raised_at is None
    assert member.hand_revision == 2
    assert call_publication.await_args.args[2]["participant"]["hand_revision"] == 2


@pytest.mark.parametrize(
    "denial",
    [
        Denial.WRONG_SESSION,
        Denial.NOT_JOINED,
        Denial.OTHER_ORG,
        Denial.OTHER_HAND,
        Denial.RAISE_OTHER,
    ],
)
async def test_participation_requires_current_device_and_authority(
    session, access, livekit, call_publication, denial
):
    call, member, auth, host_auth = await participants(session, access)
    organization_id = generate_id() if denial == Denial.OTHER_ORG else access.org_id
    device_id = "absent" if denial == Denial.NOT_JOINED else "d1"
    session_id = host_auth.id if denial == Denial.WRONG_SESSION else auth.id
    identity = (
        f"{access.owner_id}:host" if denial in {Denial.OTHER_HAND, Denial.RAISE_OTHER} else None
    )
    with pytest.raises((PermissionDeniedError, NotFoundError)):
        await CallParticipation(session).set_hand(
            access.member_id,
            organization_id,
            call.id,
            device_id,
            session_id,
            raised=denial != Denial.OTHER_HAND,
            identity=identity,
        )
    member_id = member.id
    await session.rollback()
    row = await session.scalar(select(CallParticipant).where(CallParticipant.id == member_id))
    assert row.hand_raised_at is None
    call_publication.assert_not_awaited()


async def test_reactions_are_attributed_transient_and_limited_to_participants(
    session, access, livekit, call_publication
):
    call, member, auth, _ = await participants(session, access)
    ops = CallParticipation(session)
    await ops.react(
        access.member_id, access.org_id, call.id, "d1", auth.id, reaction=CallReaction.AGREE
    )
    recipients, kind, payload = call_publication.await_args.args
    assert set(recipients) == {access.member_id, access.owner_id}
    assert kind == CALL_REACTION
    assert payload["user_id"] == str(access.member_id)
    assert payload["display_name"]
    assert (
        0 < (datetime.fromisoformat(payload["expires_at"]) - datetime.now(UTC)).total_seconds() <= 5
    )
    assert payload["reaction"] == CallReaction.AGREE
    assert call_publication.await_args.kwargs["channel_id"] == call.channel_id
    for _ in range(4):
        await ops.react(
            access.member_id, access.org_id, call.id, "d1", auth.id, reaction=CallReaction.AGREE
        )
    with pytest.raises(RateLimitExceededError):
        await ops.react(
            access.member_id, access.org_id, call.id, "d1", auth.id, reaction=CallReaction.AGREE
        )
    assert call_publication.await_count == 5


async def test_departed_participant_cannot_react_and_hand_is_absent_from_snapshot(
    session, access, livekit, call_publication
):
    call, member, auth, _ = await participants(session, access)
    ops = CallParticipation(session)
    await ops.set_hand(access.member_id, access.org_id, call.id, "d1", auth.id, raised=True)
    await CallOperations(session).mark_participant_left(call, member)
    assert member.id not in [
        p.id for p in await CallOperations(session).list_active_participants(call.id)
    ]
    with pytest.raises(PermissionDeniedError):
        await ops.react(
            access.member_id, access.org_id, call.id, "d1", auth.id, reaction=CallReaction.LOVE
        )


async def test_hand_commit_survives_publication_failure(session, access, livekit, monkeypatch):
    call, member, auth, _ = await participants(session, access)
    monkeypatch.setattr(
        CallOperations, "publish_participant_state", AsyncMock(side_effect=RuntimeError("offline"))
    )
    with pytest.raises(RuntimeError, match="offline"):
        await CallParticipation(session).set_hand(
            access.member_id, access.org_id, call.id, "d1", auth.id, raised=True
        )
    await session.rollback()
    await session.refresh(member)
    assert member.hand_raised_at is not None


async def test_unknown_reaction_is_rejected(session, access, livekit, call_publication):
    call, _, auth, _ = await participants(session, access)
    with pytest.raises(ValidationError):
        await CallParticipation(session).react(
            access.member_id,
            access.org_id,
            call.id,
            "d1",
            auth.id,
            reaction=CallReaction.UNSPECIFIED,
        )
    call_publication.assert_not_awaited()


async def test_concurrent_raise_keeps_one_queue_position(session, access, livekit, call_publication):
    call, member, auth, _ = await participants(session, access)

    async def raise_hand(other):
        return await CallParticipation(other).set_hand(
            access.member_id,
            access.org_id,
            call.id,
            "d1",
            auth.id,
            raised=True,
        )

    results = await contend(
        select(Call).where(Call.id == call.id).with_for_update(), [raise_hand, raise_hand]
    )
    assert all(isinstance(result, CallParticipant) for result in results)
    await session.refresh(member)
    assert member.hand_raised_at is not None
    assert member.hand_revision == 1
    assert call_publication.await_count == 1
