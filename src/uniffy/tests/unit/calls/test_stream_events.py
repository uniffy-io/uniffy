"""Call event payloads survive the Valkey JSON hop into proto ChatEvents."""

from datetime import UTC, datetime

from uniffy_proto.calls.v1.calls_pb import CallReaction
from uniffy_proto.calls.v1.calls_pb import CallType as ProtoCallType
from uniffy_proto.chat.v1.chat_stream_pb import ChatEventType

from uniffy.core.types import generate_id
from uniffy.domains.chat.streaming import events as evt
from uniffy.domains.chat.streaming.handlers import (
    _CHANNEL_EVENT_TYPES,
    _payload_to_channel_event,
)

CHANNEL_ID = "chan-1"
USER_ID = "u1"
DISPLAY_NAME = "Alice"


def _wire(event_type: str, payload: dict) -> dict:
    """Mimic publish_channel_event_to_members' JSON envelope."""
    return {"_type": event_type, "channel_id": CHANNEL_ID, **payload}


def _participant_dict(user_id: str = USER_ID) -> dict:
    return {
        "user_id": user_id,
        "device_id": "d1",
        "identity": f"{user_id}:d1",
        "display_name": DISPLAY_NAME,
        "avatar_url": "",
        "device_label": "Chrome",
        "joined_at": datetime.now(UTC).isoformat(),
        "mic_enabled": True,
        "camera_enabled": False,
        "screen_sharing": False,
    }


def test_call_events_route_as_channel_events():
    """Events missing from the routing set are silently dropped before conversion."""
    for event_name in (
        evt.CALL_STARTED,
        evt.CALL_ENDED,
        evt.CALL_PARTICIPANT_JOINED,
        evt.CALL_PARTICIPANT_LEFT,
        evt.CALL_PARTICIPANT_STATE,
        evt.CALL_REACTION,
        evt.CALL_RING,
        evt.CALL_HOST_CHANGED,
    ):
        assert event_name in _CHANNEL_EVENT_TYPES


def test_call_started_carries_snapshot():
    call_id = str(generate_id())
    call = {
        "call_id": call_id,
        "organization_id": str(generate_id()),
        "channel_id": CHANNEL_ID,
        "call_type": "CHANNEL",
        "initiator_user_id": USER_ID,
        "host_user_id": USER_ID,
        "started_at": datetime.now(UTC).isoformat(),
        "participants": [_participant_dict()],
    }
    event = _payload_to_channel_event(
        _wire(evt.CALL_STARTED, evt.build_call_lifecycle_payload(call))
    )
    assert event.event_type == ChatEventType.CALL_STARTED
    assert event.channel_id == CHANNEL_ID
    assert event.payload.value.call.id == call_id
    assert event.payload.value.call.call_type == ProtoCallType.CHANNEL
    assert event.payload.value.call.participants[0].identity == f"{USER_ID}:d1"


def test_call_ended_maps_end_reason():
    call = {
        "call_id": str(generate_id()),
        "organization_id": str(generate_id()),
        "channel_id": CHANNEL_ID,
        "call_type": "DIRECT",
        "initiator_user_id": USER_ID,
        "host_user_id": USER_ID,
        "started_at": datetime.now(UTC).isoformat(),
        "ended_at": datetime.now(UTC).isoformat(),
        "end_reason": "ALL_LEFT",
        "participants": [],
    }
    event = _payload_to_channel_event(_wire(evt.CALL_ENDED, evt.build_call_lifecycle_payload(call)))
    assert event.event_type == ChatEventType.CALL_ENDED
    assert event.payload.value.call.has_field("ended_at")


def test_participant_events_carry_count():
    call_id = generate_id()
    for event_name, proto_type in (
        (evt.CALL_PARTICIPANT_JOINED, ChatEventType.CALL_PARTICIPANT_JOINED),
        (evt.CALL_PARTICIPANT_LEFT, ChatEventType.CALL_PARTICIPANT_LEFT),
        (evt.CALL_PARTICIPANT_STATE, ChatEventType.CALL_PARTICIPANT_STATE),
    ):
        payload = evt.build_call_participant_payload(call_id, _participant_dict(), 3)
        event = _payload_to_channel_event(_wire(event_name, payload))
        assert event.event_type == proto_type
        assert event.payload.value.call_id == str(call_id)
        assert event.payload.value.active_participant_count == 3


def test_call_ring_payload():
    call_id = generate_id()
    caller_id = generate_id()
    payload = evt.build_call_ring_payload(
        call_id=call_id,
        channel_name="Q1 Planning",
        call_type="GROUP_DM",
        caller_user_id=caller_id,
        caller_name=DISPLAY_NAME,
        caller_avatar_url=None,
        expires_at=datetime.now(UTC),
    )
    event = _payload_to_channel_event(_wire(evt.CALL_RING, payload))
    assert event.event_type == ChatEventType.CALL_RING
    assert event.payload.value.call_id == str(call_id)
    assert event.payload.value.call_type == ProtoCallType.GROUP_DM
    assert event.payload.value.caller_name == DISPLAY_NAME
    assert event.payload.value.has_field("expires_at")


def test_call_host_changed():
    call_id, new_host = generate_id(), generate_id()
    payload = evt.build_call_host_changed_payload(call_id, new_host)
    event = _payload_to_channel_event(_wire(evt.CALL_HOST_CHANGED, payload))
    assert event.event_type == ChatEventType.CALL_HOST_CHANGED
    assert event.payload.value.new_host_user_id == str(new_host)


def test_moderator_mute_is_distinct_from_self_mute():
    for muted_by_moderator in (False, True):
        payload = evt.build_call_participant_payload(
            generate_id(), _participant_dict(), 2, moderator_muted=muted_by_moderator
        )
        event = _payload_to_channel_event(_wire(evt.CALL_PARTICIPANT_STATE, payload))
        assert event.payload.value.moderator_muted is muted_by_moderator


def test_hand_state_survives_stream_conversion():
    participant = _participant_dict()
    participant.update(hand_raised_at="2026-10-29T11:00:00.123456+00:00", hand_revision=3)
    event = _payload_to_channel_event(
        _wire(
            evt.CALL_PARTICIPANT_STATE,
            evt.build_call_participant_payload(generate_id(), participant, 2),
        )
    )
    assert event.payload.value.participant.hand_raised_at.nanos == 123456000
    assert event.payload.value.participant.hand_revision == 3


def test_reaction_retains_sender_and_expiry():
    event = _payload_to_channel_event(
        _wire(
            evt.CALL_REACTION,
            {
                "call_id": "call-1",
                "id": "reaction-1",
                "user_id": USER_ID,
                "display_name": DISPLAY_NAME,
                "reaction": int(CallReaction.AGREE),
                "expires_at": "2026-10-29T11:00:00+00:00",
            },
        )
    )
    assert event.event_type == ChatEventType.CALL_REACTION
    assert event.channel_id == CHANNEL_ID
    assert event.payload.value.user_id == USER_ID
    assert event.payload.value.display_name == DISPLAY_NAME
    assert event.payload.value.reaction == CallReaction.AGREE
    assert event.payload.value.expires_at is not None
