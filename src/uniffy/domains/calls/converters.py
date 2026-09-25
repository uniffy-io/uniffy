"""Call model <-> proto and stream-event dict conversion."""

from typing import Any

from protobuf.wkt import Timestamp
from uniffy_proto.calls.v1.calls_pb import (
    Call as ProtoCall,
)
from uniffy_proto.calls.v1.calls_pb import (
    CallEndReason as ProtoCallEndReason,
)
from uniffy_proto.calls.v1.calls_pb import (
    CallParticipant as ProtoCallParticipant,
)
from uniffy_proto.calls.v1.calls_pb import (
    CallType as ProtoCallType,
)
from uniffy_proto.calls.v1.calls_pb import (
    OrgCallPolicy as ProtoOrgCallPolicy,
)

from uniffy.core.converters.proto import datetime_to_timestamp
from uniffy.core.models.calls import (
    Call,
    CallEndReason,
    CallParticipant,
    CallType,
)
from uniffy.domains.calls.policy import ResolvedCallPolicy

CALL_TYPE_TO_PROTO = {
    CallType.DIRECT: ProtoCallType.DIRECT,
    CallType.GROUP_DM: ProtoCallType.GROUP_DM,
    CallType.CHANNEL: ProtoCallType.CHANNEL,
}

CALL_END_REASON_TO_PROTO = {
    CallEndReason.HOST_ENDED: ProtoCallEndReason.HOST_ENDED,
    CallEndReason.ALL_LEFT: ProtoCallEndReason.ALL_LEFT,
    CallEndReason.MAX_DURATION: ProtoCallEndReason.MAX_DURATION,
    CallEndReason.SOLO_TIMEOUT: ProtoCallEndReason.SOLO_TIMEOUT,
    CallEndReason.CHANNEL_ARCHIVED: ProtoCallEndReason.CHANNEL_ARCHIVED,
    CallEndReason.ORG_SUSPENDED: ProtoCallEndReason.ORG_SUSPENDED,
    CallEndReason.ORG_DELETED: ProtoCallEndReason.ORG_DELETED,
}


def _ts(dt) -> Timestamp:
    ts = Timestamp()
    ts = datetime_to_timestamp(dt)
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
        call_type=CALL_TYPE_TO_PROTO.get(call.call_type, ProtoCallType.UNSPECIFIED),
        initiator_user_id=str(call.initiator_user_id),
        host_user_id=str(call.host_user_id),
        started_at=_ts(call.started_at),
        participants=[
            participant_to_proto(
                p,
                display_name=getattr(profiles.get(p.user_id), "display_name", ""),
                avatar_url=getattr(profiles.get(p.user_id), "avatar_url", None) or None,
            )
            for p in participants
        ],
    )
    if call.ended_at is not None:
        proto.ended_at = _ts(call.ended_at)
    if call.end_reason is not None:
        proto.end_reason = CALL_END_REASON_TO_PROTO.get(
            call.end_reason, ProtoCallEndReason.UNSPECIFIED
        )
    return proto


def org_policy_to_proto(policy: ResolvedCallPolicy) -> ProtoOrgCallPolicy:
    return ProtoOrgCallPolicy(
        organization_id=str(policy.organization_id),
        calls_enabled=policy.calls_enabled,
        max_participants=policy.max_participants,
        max_duration_minutes=policy.max_duration_minutes,
        # ScreenShareQuality ints match the proto enum values by construction.
        max_screen_share_quality_direct=int(policy.max_screen_share_quality_direct),
        max_screen_share_quality_group=int(policy.max_screen_share_quality_group),
        max_screen_share_quality_channel=int(policy.max_screen_share_quality_channel),
    )


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
                avatar_url=getattr(profiles.get(p.user_id), "avatar_url", None) or None,
            )
            for p in participants
        ],
    }
    if call.ended_at is not None:
        data["ended_at"] = call.ended_at.isoformat()
    if call.end_reason is not None:
        data["end_reason"] = call.end_reason.value
    return data
