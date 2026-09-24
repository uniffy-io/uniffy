import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class CallType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    CALL_TYPE_UNSPECIFIED: _ClassVar[CallType]
    CALL_TYPE_DIRECT: _ClassVar[CallType]
    CALL_TYPE_GROUP_DM: _ClassVar[CallType]
    CALL_TYPE_CHANNEL: _ClassVar[CallType]

class CallEndReason(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    CALL_END_REASON_UNSPECIFIED: _ClassVar[CallEndReason]
    CALL_END_REASON_HOST_ENDED: _ClassVar[CallEndReason]
    CALL_END_REASON_ALL_LEFT: _ClassVar[CallEndReason]
    CALL_END_REASON_MAX_DURATION: _ClassVar[CallEndReason]
    CALL_END_REASON_SOLO_TIMEOUT: _ClassVar[CallEndReason]
    CALL_END_REASON_CHANNEL_ARCHIVED: _ClassVar[CallEndReason]
    CALL_END_REASON_ORG_SUSPENDED: _ClassVar[CallEndReason]
    CALL_END_REASON_ORG_DELETED: _ClassVar[CallEndReason]

class ScreenShareQuality(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SCREEN_SHARE_QUALITY_UNSPECIFIED: _ClassVar[ScreenShareQuality]
    SCREEN_SHARE_QUALITY_BALANCED: _ClassVar[ScreenShareQuality]
    SCREEN_SHARE_QUALITY_HIGH: _ClassVar[ScreenShareQuality]
    SCREEN_SHARE_QUALITY_MAX: _ClassVar[ScreenShareQuality]

class IceTransportPolicy(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ICE_TRANSPORT_POLICY_UNSPECIFIED: _ClassVar[IceTransportPolicy]
    ICE_TRANSPORT_POLICY_ALL: _ClassVar[IceTransportPolicy]
    ICE_TRANSPORT_POLICY_RELAY: _ClassVar[IceTransportPolicy]
CALL_TYPE_UNSPECIFIED: CallType
CALL_TYPE_DIRECT: CallType
CALL_TYPE_GROUP_DM: CallType
CALL_TYPE_CHANNEL: CallType
CALL_END_REASON_UNSPECIFIED: CallEndReason
CALL_END_REASON_HOST_ENDED: CallEndReason
CALL_END_REASON_ALL_LEFT: CallEndReason
CALL_END_REASON_MAX_DURATION: CallEndReason
CALL_END_REASON_SOLO_TIMEOUT: CallEndReason
CALL_END_REASON_CHANNEL_ARCHIVED: CallEndReason
CALL_END_REASON_ORG_SUSPENDED: CallEndReason
CALL_END_REASON_ORG_DELETED: CallEndReason
SCREEN_SHARE_QUALITY_UNSPECIFIED: ScreenShareQuality
SCREEN_SHARE_QUALITY_BALANCED: ScreenShareQuality
SCREEN_SHARE_QUALITY_HIGH: ScreenShareQuality
SCREEN_SHARE_QUALITY_MAX: ScreenShareQuality
ICE_TRANSPORT_POLICY_UNSPECIFIED: IceTransportPolicy
ICE_TRANSPORT_POLICY_ALL: IceTransportPolicy
ICE_TRANSPORT_POLICY_RELAY: IceTransportPolicy

class IceServer(_message.Message):
    __slots__ = ("urls", "username", "credential")
    URLS_FIELD_NUMBER: _ClassVar[int]
    USERNAME_FIELD_NUMBER: _ClassVar[int]
    CREDENTIAL_FIELD_NUMBER: _ClassVar[int]
    urls: _containers.RepeatedScalarFieldContainer[str]
    username: str
    credential: str
    def __init__(self, urls: _Optional[_Iterable[str]] = ..., username: _Optional[str] = ..., credential: _Optional[str] = ...) -> None: ...

class Call(_message.Message):
    __slots__ = ("id", "organization_id", "channel_id", "call_type", "initiator_user_id", "host_user_id", "started_at", "ended_at", "end_reason", "participants")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    CALL_TYPE_FIELD_NUMBER: _ClassVar[int]
    INITIATOR_USER_ID_FIELD_NUMBER: _ClassVar[int]
    HOST_USER_ID_FIELD_NUMBER: _ClassVar[int]
    STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    ENDED_AT_FIELD_NUMBER: _ClassVar[int]
    END_REASON_FIELD_NUMBER: _ClassVar[int]
    PARTICIPANTS_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    channel_id: str
    call_type: CallType
    initiator_user_id: str
    host_user_id: str
    started_at: _timestamp_pb2.Timestamp
    ended_at: _timestamp_pb2.Timestamp
    end_reason: CallEndReason
    participants: _containers.RepeatedCompositeFieldContainer[CallParticipant]
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., call_type: _Optional[_Union[CallType, str]] = ..., initiator_user_id: _Optional[str] = ..., host_user_id: _Optional[str] = ..., started_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., ended_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end_reason: _Optional[_Union[CallEndReason, str]] = ..., participants: _Optional[_Iterable[_Union[CallParticipant, _Mapping]]] = ...) -> None: ...

class CallParticipant(_message.Message):
    __slots__ = ("user_id", "device_id", "identity", "display_name", "avatar_url", "device_label", "joined_at", "mic_enabled", "camera_enabled", "screen_sharing")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    DEVICE_ID_FIELD_NUMBER: _ClassVar[int]
    IDENTITY_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    AVATAR_URL_FIELD_NUMBER: _ClassVar[int]
    DEVICE_LABEL_FIELD_NUMBER: _ClassVar[int]
    JOINED_AT_FIELD_NUMBER: _ClassVar[int]
    MIC_ENABLED_FIELD_NUMBER: _ClassVar[int]
    CAMERA_ENABLED_FIELD_NUMBER: _ClassVar[int]
    SCREEN_SHARING_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    device_id: str
    identity: str
    display_name: str
    avatar_url: str
    device_label: str
    joined_at: _timestamp_pb2.Timestamp
    mic_enabled: bool
    camera_enabled: bool
    screen_sharing: bool
    def __init__(self, user_id: _Optional[str] = ..., device_id: _Optional[str] = ..., identity: _Optional[str] = ..., display_name: _Optional[str] = ..., avatar_url: _Optional[str] = ..., device_label: _Optional[str] = ..., joined_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., mic_enabled: _Optional[bool] = ..., camera_enabled: _Optional[bool] = ..., screen_sharing: _Optional[bool] = ...) -> None: ...

class InitiateCallRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "device_id", "device_label")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    DEVICE_ID_FIELD_NUMBER: _ClassVar[int]
    DEVICE_LABEL_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    device_id: str
    device_label: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., device_id: _Optional[str] = ..., device_label: _Optional[str] = ...) -> None: ...

class InitiateCallResponse(_message.Message):
    __slots__ = ("call", "ws_url", "livekit_token", "joined_existing", "screen_share_quality_cap", "ice_servers", "ice_transport_policy")
    CALL_FIELD_NUMBER: _ClassVar[int]
    WS_URL_FIELD_NUMBER: _ClassVar[int]
    LIVEKIT_TOKEN_FIELD_NUMBER: _ClassVar[int]
    JOINED_EXISTING_FIELD_NUMBER: _ClassVar[int]
    SCREEN_SHARE_QUALITY_CAP_FIELD_NUMBER: _ClassVar[int]
    ICE_SERVERS_FIELD_NUMBER: _ClassVar[int]
    ICE_TRANSPORT_POLICY_FIELD_NUMBER: _ClassVar[int]
    call: Call
    ws_url: str
    livekit_token: str
    joined_existing: bool
    screen_share_quality_cap: ScreenShareQuality
    ice_servers: _containers.RepeatedCompositeFieldContainer[IceServer]
    ice_transport_policy: IceTransportPolicy
    def __init__(self, call: _Optional[_Union[Call, _Mapping]] = ..., ws_url: _Optional[str] = ..., livekit_token: _Optional[str] = ..., joined_existing: _Optional[bool] = ..., screen_share_quality_cap: _Optional[_Union[ScreenShareQuality, str]] = ..., ice_servers: _Optional[_Iterable[_Union[IceServer, _Mapping]]] = ..., ice_transport_policy: _Optional[_Union[IceTransportPolicy, str]] = ...) -> None: ...

class JoinCallRequest(_message.Message):
    __slots__ = ("organization_id", "call_id", "device_id", "device_label")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CALL_ID_FIELD_NUMBER: _ClassVar[int]
    DEVICE_ID_FIELD_NUMBER: _ClassVar[int]
    DEVICE_LABEL_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    call_id: str
    device_id: str
    device_label: str
    def __init__(self, organization_id: _Optional[str] = ..., call_id: _Optional[str] = ..., device_id: _Optional[str] = ..., device_label: _Optional[str] = ...) -> None: ...

class JoinCallResponse(_message.Message):
    __slots__ = ("call", "ws_url", "livekit_token", "screen_share_quality_cap", "ice_servers", "ice_transport_policy")
    CALL_FIELD_NUMBER: _ClassVar[int]
    WS_URL_FIELD_NUMBER: _ClassVar[int]
    LIVEKIT_TOKEN_FIELD_NUMBER: _ClassVar[int]
    SCREEN_SHARE_QUALITY_CAP_FIELD_NUMBER: _ClassVar[int]
    ICE_SERVERS_FIELD_NUMBER: _ClassVar[int]
    ICE_TRANSPORT_POLICY_FIELD_NUMBER: _ClassVar[int]
    call: Call
    ws_url: str
    livekit_token: str
    screen_share_quality_cap: ScreenShareQuality
    ice_servers: _containers.RepeatedCompositeFieldContainer[IceServer]
    ice_transport_policy: IceTransportPolicy
    def __init__(self, call: _Optional[_Union[Call, _Mapping]] = ..., ws_url: _Optional[str] = ..., livekit_token: _Optional[str] = ..., screen_share_quality_cap: _Optional[_Union[ScreenShareQuality, str]] = ..., ice_servers: _Optional[_Iterable[_Union[IceServer, _Mapping]]] = ..., ice_transport_policy: _Optional[_Union[IceTransportPolicy, str]] = ...) -> None: ...

class LeaveCallRequest(_message.Message):
    __slots__ = ("organization_id", "call_id", "device_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CALL_ID_FIELD_NUMBER: _ClassVar[int]
    DEVICE_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    call_id: str
    device_id: str
    def __init__(self, organization_id: _Optional[str] = ..., call_id: _Optional[str] = ..., device_id: _Optional[str] = ...) -> None: ...

class LeaveCallResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class EndCallRequest(_message.Message):
    __slots__ = ("organization_id", "call_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CALL_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    call_id: str
    def __init__(self, organization_id: _Optional[str] = ..., call_id: _Optional[str] = ...) -> None: ...

class EndCallResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class RefreshCallTokenRequest(_message.Message):
    __slots__ = ("organization_id", "call_id", "device_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CALL_ID_FIELD_NUMBER: _ClassVar[int]
    DEVICE_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    call_id: str
    device_id: str
    def __init__(self, organization_id: _Optional[str] = ..., call_id: _Optional[str] = ..., device_id: _Optional[str] = ...) -> None: ...

class RefreshCallTokenResponse(_message.Message):
    __slots__ = ("livekit_token",)
    LIVEKIT_TOKEN_FIELD_NUMBER: _ClassVar[int]
    livekit_token: str
    def __init__(self, livekit_token: _Optional[str] = ...) -> None: ...

class GetActiveCallRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ...) -> None: ...

class GetActiveCallResponse(_message.Message):
    __slots__ = ("call",)
    CALL_FIELD_NUMBER: _ClassVar[int]
    call: Call
    def __init__(self, call: _Optional[_Union[Call, _Mapping]] = ...) -> None: ...

class ListActiveCallsRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class ListActiveCallsResponse(_message.Message):
    __slots__ = ("calls",)
    CALLS_FIELD_NUMBER: _ClassVar[int]
    calls: _containers.RepeatedCompositeFieldContainer[Call]
    def __init__(self, calls: _Optional[_Iterable[_Union[Call, _Mapping]]] = ...) -> None: ...

class DeclineCallRequest(_message.Message):
    __slots__ = ("organization_id", "call_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CALL_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    call_id: str
    def __init__(self, organization_id: _Optional[str] = ..., call_id: _Optional[str] = ...) -> None: ...

class DeclineCallResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class KickParticipantRequest(_message.Message):
    __slots__ = ("organization_id", "call_id", "identity")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CALL_ID_FIELD_NUMBER: _ClassVar[int]
    IDENTITY_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    call_id: str
    identity: str
    def __init__(self, organization_id: _Optional[str] = ..., call_id: _Optional[str] = ..., identity: _Optional[str] = ...) -> None: ...

class KickParticipantResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class MuteParticipantRequest(_message.Message):
    __slots__ = ("organization_id", "call_id", "identity")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CALL_ID_FIELD_NUMBER: _ClassVar[int]
    IDENTITY_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    call_id: str
    identity: str
    def __init__(self, organization_id: _Optional[str] = ..., call_id: _Optional[str] = ..., identity: _Optional[str] = ...) -> None: ...

class MuteParticipantResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class ReportMediaStateRequest(_message.Message):
    __slots__ = ("organization_id", "call_id", "device_id", "mic_enabled", "camera_enabled", "screen_sharing")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CALL_ID_FIELD_NUMBER: _ClassVar[int]
    DEVICE_ID_FIELD_NUMBER: _ClassVar[int]
    MIC_ENABLED_FIELD_NUMBER: _ClassVar[int]
    CAMERA_ENABLED_FIELD_NUMBER: _ClassVar[int]
    SCREEN_SHARING_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    call_id: str
    device_id: str
    mic_enabled: bool
    camera_enabled: bool
    screen_sharing: bool
    def __init__(self, organization_id: _Optional[str] = ..., call_id: _Optional[str] = ..., device_id: _Optional[str] = ..., mic_enabled: _Optional[bool] = ..., camera_enabled: _Optional[bool] = ..., screen_sharing: _Optional[bool] = ...) -> None: ...

class ReportMediaStateResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class OrgCallPolicy(_message.Message):
    __slots__ = ("organization_id", "calls_enabled", "max_participants", "max_duration_minutes", "max_screen_share_quality_direct", "max_screen_share_quality_group", "max_screen_share_quality_channel")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CALLS_ENABLED_FIELD_NUMBER: _ClassVar[int]
    MAX_PARTICIPANTS_FIELD_NUMBER: _ClassVar[int]
    MAX_DURATION_MINUTES_FIELD_NUMBER: _ClassVar[int]
    MAX_SCREEN_SHARE_QUALITY_DIRECT_FIELD_NUMBER: _ClassVar[int]
    MAX_SCREEN_SHARE_QUALITY_GROUP_FIELD_NUMBER: _ClassVar[int]
    MAX_SCREEN_SHARE_QUALITY_CHANNEL_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    calls_enabled: bool
    max_participants: int
    max_duration_minutes: int
    max_screen_share_quality_direct: ScreenShareQuality
    max_screen_share_quality_group: ScreenShareQuality
    max_screen_share_quality_channel: ScreenShareQuality
    def __init__(self, organization_id: _Optional[str] = ..., calls_enabled: _Optional[bool] = ..., max_participants: _Optional[int] = ..., max_duration_minutes: _Optional[int] = ..., max_screen_share_quality_direct: _Optional[_Union[ScreenShareQuality, str]] = ..., max_screen_share_quality_group: _Optional[_Union[ScreenShareQuality, str]] = ..., max_screen_share_quality_channel: _Optional[_Union[ScreenShareQuality, str]] = ...) -> None: ...

class GetOrgCallPolicyRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class GetOrgCallPolicyResponse(_message.Message):
    __slots__ = ("policy",)
    POLICY_FIELD_NUMBER: _ClassVar[int]
    policy: OrgCallPolicy
    def __init__(self, policy: _Optional[_Union[OrgCallPolicy, _Mapping]] = ...) -> None: ...

class UpdateOrgCallPolicyRequest(_message.Message):
    __slots__ = ("organization_id", "calls_enabled", "max_participants", "max_duration_minutes", "max_screen_share_quality_direct", "max_screen_share_quality_group", "max_screen_share_quality_channel")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CALLS_ENABLED_FIELD_NUMBER: _ClassVar[int]
    MAX_PARTICIPANTS_FIELD_NUMBER: _ClassVar[int]
    MAX_DURATION_MINUTES_FIELD_NUMBER: _ClassVar[int]
    MAX_SCREEN_SHARE_QUALITY_DIRECT_FIELD_NUMBER: _ClassVar[int]
    MAX_SCREEN_SHARE_QUALITY_GROUP_FIELD_NUMBER: _ClassVar[int]
    MAX_SCREEN_SHARE_QUALITY_CHANNEL_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    calls_enabled: bool
    max_participants: int
    max_duration_minutes: int
    max_screen_share_quality_direct: ScreenShareQuality
    max_screen_share_quality_group: ScreenShareQuality
    max_screen_share_quality_channel: ScreenShareQuality
    def __init__(self, organization_id: _Optional[str] = ..., calls_enabled: _Optional[bool] = ..., max_participants: _Optional[int] = ..., max_duration_minutes: _Optional[int] = ..., max_screen_share_quality_direct: _Optional[_Union[ScreenShareQuality, str]] = ..., max_screen_share_quality_group: _Optional[_Union[ScreenShareQuality, str]] = ..., max_screen_share_quality_channel: _Optional[_Union[ScreenShareQuality, str]] = ...) -> None: ...

class UpdateOrgCallPolicyResponse(_message.Message):
    __slots__ = ("policy",)
    POLICY_FIELD_NUMBER: _ClassVar[int]
    policy: OrgCallPolicy
    def __init__(self, policy: _Optional[_Union[OrgCallPolicy, _Mapping]] = ...) -> None: ...
