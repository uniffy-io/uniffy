"""Call event payloads survive the Valkey JSON hop into proto ChatEvents."""

import uuid
from datetime import UTC, datetime

from uniffy_proto.calls.v1.calls_pb2 import CallType as ProtoCallType
from uniffy_proto.chat.v1.chat_stream_pb2 import ChatEventType

from uniffy.domains.chat.streaming import events as evt
from uniffy.domains.chat.streaming.handlers import (
    _CHANNEL_EVENT_TYPES,
    _payload_to_channel_event,
)


def _wire(event_type: str, payload: dict) -> dict:
    """Mimic publish_channel_event_to_members' JSON envelope."""
    return {"_type": event_type, "channel_id": "chan-1", **payload}


def _participant_dict(user_id: str = "u1") -> dict:
    return {
        "user_id": user_id,
        "device_id": "d1",
        "identity": f"{user_id}:d1",
        "display_name": "Alice",
        "avatar_url": "",
        "device_label": "Chrome",
        "joined_at": datetime.now(UTC).isoformat(),
        "mic_enabled": True,
        "camera_enabled": False,
        "screen_sharing": False,
    }


def test_call_events_route_as_channel_events():
    """The stream loop only converts types in _CHANNEL_EVENT_TYPES; a call
    event missing from that set is silently dropped before conversion."""
    for event_name in (
        evt.CALL_STARTED,
        evt.CALL_ENDED,
        evt.CALL_PARTICIPANT_JOINED,
        evt.CALL_PARTICIPANT_LEFT,
        evt.CALL_PARTICIPANT_STATE,
        evt.CALL_RING,
        evt.CALL_HOST_CHANGED,
    ):
        assert event_name in _CHANNEL_EVENT_TYPES


def test_call_started_carries_snapshot():
    call_id = str(uuid.uuid4())
    call = {
        "call_id": call_id,
        "organization_id": str(uuid.uuid4()),
        "channel_id": "chan-1",
        "call_type": "CHANNEL",
        "initiator_user_id": "u1",
        "host_user_id": "u1",
        "started_at": datetime.now(UTC).isoformat(),
        "participants": [_participant_dict()],
    }
    event = _payload_to_channel_event(
        _wire(evt.CALL_STARTED, evt.build_call_lifecycle_payload(call))
    )
    assert event.event_type == ChatEventType.CHAT_EVENT_TYPE_CALL_STARTED
    assert event.channel_id == "chan-1"
    assert event.call_lifecycle.call.id == call_id
    assert event.call_lifecycle.call.call_type == ProtoCallType.CALL_TYPE_CHANNEL
    assert event.call_lifecycle.call.participants[0].identity == "u1:d1"


def test_call_ended_maps_end_reason():
    call = {
        "call_id": str(uuid.uuid4()),
        "organization_id": str(uuid.uuid4()),
        "channel_id": "chan-1",
        "call_type": "DIRECT",
        "initiator_user_id": "u1",
        "host_user_id": "u1",
        "started_at": datetime.now(UTC).isoformat(),
        "ended_at": datetime.now(UTC).isoformat(),
        "end_reason": "ALL_LEFT",
        "participants": [],
    }
    event = _payload_to_channel_event(_wire(evt.CALL_ENDED, evt.build_call_lifecycle_payload(call)))
    assert event.event_type == ChatEventType.CHAT_EVENT_TYPE_CALL_ENDED
    assert event.call_lifecycle.call.HasField("ended_at")


def test_participant_events_carry_count():
    call_id = uuid.uuid4()
    for event_name, proto_type in (
        (evt.CALL_PARTICIPANT_JOINED, ChatEventType.CHAT_EVENT_TYPE_CALL_PARTICIPANT_JOINED),
        (evt.CALL_PARTICIPANT_LEFT, ChatEventType.CHAT_EVENT_TYPE_CALL_PARTICIPANT_LEFT),
        (evt.CALL_PARTICIPANT_STATE, ChatEventType.CHAT_EVENT_TYPE_CALL_PARTICIPANT_STATE),
    ):
        payload = evt.build_call_participant_payload(call_id, _participant_dict(), 3)
        event = _payload_to_channel_event(_wire(event_name, payload))
        assert event.event_type == proto_type
        assert event.call_participant.call_id == str(call_id)
        assert event.call_participant.active_participant_count == 3


def test_call_ring_payload():
    call_id = uuid.uuid4()
    caller_id = uuid.uuid4()
    payload = evt.build_call_ring_payload(
        call_id=call_id,
        channel_name="Q1 Planning",
        call_type="GROUP_DM",
        caller_user_id=caller_id,
        caller_name="Alice",
        caller_avatar_url=None,
        expires_at=datetime.now(UTC),
    )
    event = _payload_to_channel_event(_wire(evt.CALL_RING, payload))
    assert event.event_type == ChatEventType.CHAT_EVENT_TYPE_CALL_RING
    assert event.call_ring.call_id == str(call_id)
    assert event.call_ring.call_type == ProtoCallType.CALL_TYPE_GROUP_DM
    assert event.call_ring.caller_name == "Alice"
    assert event.call_ring.HasField("expires_at")


def test_call_host_changed():
    call_id, new_host = uuid.uuid4(), uuid.uuid4()
    payload = evt.build_call_host_changed_payload(call_id, new_host)
    event = _payload_to_channel_event(_wire(evt.CALL_HOST_CHANGED, payload))
    assert event.event_type == ChatEventType.CHAT_EVENT_TYPE_CALL_HOST_CHANGED
    assert event.call_host_changed.new_host_user_id == str(new_host)
