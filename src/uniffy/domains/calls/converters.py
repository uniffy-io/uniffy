"""Call model <-> proto and stream-event dict conversion."""

from typing import Any

from google.protobuf.timestamp_pb2 import Timestamp
from uniffy_proto.calls.v1.calls_pb2 import (
    Call as ProtoCall,
)
from uniffy_proto.calls.v1.calls_pb2 import (
    CallEndReason as ProtoCallEndReason,
)
from uniffy_proto.calls.v1.calls_pb2 import (
    CallParticipant as ProtoCallParticipant,
)
from uniffy_proto.calls.v1.calls_pb2 import (
    CallType as ProtoCallType,
)

from uniffy.core.models.calls import Call, CallEndReason, CallParticipant, CallType

CALL_TYPE_TO_PROTO = {
    CallType.DIRECT: ProtoCallType.CALL_TYPE_DIRECT,
    CallType.GROUP_DM: ProtoCallType.CALL_TYPE_GROUP_DM,
    CallType.CHANNEL: ProtoCallType.CALL_TYPE_CHANNEL,
}

CALL_END_REASON_TO_PROTO = {
    CallEndReason.HOST_ENDED: ProtoCallEndReason.CALL_END_REASON_HOST_ENDED,
    CallEndReason.ALL_LEFT: ProtoCallEndReason.CALL_END_REASON_ALL_LEFT,
    CallEndReason.MAX_DURATION: ProtoCallEndReason.CALL_END_REASON_MAX_DURATION,
    CallEndReason.SOLO_TIMEOUT: ProtoCallEndReason.CALL_END_REASON_SOLO_TIMEOUT,
    CallEndReason.CHANNEL_ARCHIVED: ProtoCallEndReason.CALL_END_REASON_CHANNEL_ARCHIVED,
}


def _ts(dt) -> Timestamp:
    ts = Timestamp()
    ts.FromDatetime(dt)
    return ts


def participant_to_proto(
    participant: CallParticipant,
    display_name: str = "",
    avatar_url: str | None = None,
) -> ProtoCallParticipant:
    proto = ProtoCallParticipant(
        user_id=str(participant.user_id),
        device_id=participant.device_id,
        identity=participant.identity,
        display_name=display_name,
        avatar_url=avatar_url or "",
        device_label=participant.device_label or "",
        joined_at=_ts(participant.joined_at),
        mic_enabled=participant.mic_enabled,
        camera_enabled=participant.camera_enabled,
        screen_sharing=participant.screen_sharing,
    )
    return proto


def call_to_proto(
    call: Call,
    participants: list[CallParticipant],
    profiles: dict[Any, Any] | None = None,
) -> ProtoCall:
    """`profiles` maps user_id -> SenderInfo for display names/avatars."""
    profiles = profiles or {}
    proto = ProtoCall(
        id=str(call.id),
        organization_id=str(call.organization_id),
        channel_id=str(call.channel_id),
        call_type=CALL_TYPE_TO_PROTO.get(call.call_type, ProtoCallType.CALL_TYPE_UNSPECIFIED),
        initiator_user_id=str(call.initiator_user_id),
        host_user_id=str(call.host_user_id),
        started_at=_ts(call.started_at),
        participants=[
            participant_to_proto(
                p,
                display_name=getattr(profiles.get(p.user_id), "display_name", ""),
                avatar_url=getattr(profiles.get(p.user_id), "avatar_key", None),
            )
            for p in participants
        ],
    )
    if call.ended_at is not None:
        proto.ended_at.CopyFrom(_ts(call.ended_at))
    if call.end_reason is not None:
        proto.end_reason = CALL_END_REASON_TO_PROTO.get(
            call.end_reason, ProtoCallEndReason.CALL_END_REASON_UNSPECIFIED
        )
    return proto


def participant_to_event_dict(
    participant: CallParticipant,
    display_name: str = "",
    avatar_url: str | None = None,
) -> dict[str, Any]:
    return {
        "user_id": str(participant.user_id),
        "device_id": participant.device_id,
        "identity": participant.identity,
        "display_name": display_name,
        "avatar_url": avatar_url or "",
        "device_label": participant.device_label or "",
        "joined_at": participant.joined_at.isoformat(),
        "mic_enabled": participant.mic_enabled,
        "camera_enabled": participant.camera_enabled,
        "screen_sharing": participant.screen_sharing,
    }


def call_to_event_dict(
    call: Call,
    participants: list[CallParticipant],
    profiles: dict[Any, Any] | None = None,
) -> dict[str, Any]:
    profiles = profiles or {}
    data: dict[str, Any] = {
        "call_id": str(call.id),
        "organization_id": str(call.organization_id),
        "channel_id": str(call.channel_id),
        "call_type": call.call_type.value,
        "initiator_user_id": str(call.initiator_user_id),
        "host_user_id": str(call.host_user_id),
        "started_at": call.started_at.isoformat(),
        "participants": [
            participant_to_event_dict(
                p,
                display_name=getattr(profiles.get(p.user_id), "display_name", ""),
                avatar_url=getattr(profiles.get(p.user_id), "avatar_key", None),
            )
            for p in participants
        ],
    }
    if call.ended_at is not None:
        data["ended_at"] = call.ended_at.isoformat()
    if call.end_reason is not None:
        data["end_reason"] = call.end_reason.value
    return data
