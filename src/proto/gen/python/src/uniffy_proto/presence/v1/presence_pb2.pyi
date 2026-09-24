import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class PresenceStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    PRESENCE_STATUS_UNSPECIFIED: _ClassVar[PresenceStatus]
    PRESENCE_STATUS_ONLINE: _ClassVar[PresenceStatus]
    PRESENCE_STATUS_AWAY: _ClassVar[PresenceStatus]
    PRESENCE_STATUS_DND: _ClassVar[PresenceStatus]
    PRESENCE_STATUS_OFFLINE: _ClassVar[PresenceStatus]
PRESENCE_STATUS_UNSPECIFIED: PresenceStatus
PRESENCE_STATUS_ONLINE: PresenceStatus
PRESENCE_STATUS_AWAY: PresenceStatus
PRESENCE_STATUS_DND: PresenceStatus
PRESENCE_STATUS_OFFLINE: PresenceStatus

class SetPresenceRequest(_message.Message):
    __slots__ = ("organization_id", "status", "client")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    CLIENT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    status: PresenceStatus
    client: str
    def __init__(self, organization_id: _Optional[str] = ..., status: _Optional[_Union[PresenceStatus, str]] = ..., client: _Optional[str] = ...) -> None: ...

class SetPresenceResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetBulkPresenceRequest(_message.Message):
    __slots__ = ("organization_id", "user_ids")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_IDS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    user_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, organization_id: _Optional[str] = ..., user_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class GetBulkPresenceResponse(_message.Message):
    __slots__ = ("presences",)
    class PresencesEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: UserPresence
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[UserPresence, _Mapping]] = ...) -> None: ...
    PRESENCES_FIELD_NUMBER: _ClassVar[int]
    presences: _containers.MessageMap[str, UserPresence]
    def __init__(self, presences: _Optional[_Mapping[str, UserPresence]] = ...) -> None: ...

class UserPresence(_message.Message):
    __slots__ = ("status", "last_active", "status_emoji", "status_text", "status_expires_at")
    STATUS_FIELD_NUMBER: _ClassVar[int]
    LAST_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    STATUS_EMOJI_FIELD_NUMBER: _ClassVar[int]
    STATUS_TEXT_FIELD_NUMBER: _ClassVar[int]
    STATUS_EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    status: PresenceStatus
    last_active: _timestamp_pb2.Timestamp
    status_emoji: str
    status_text: str
    status_expires_at: _timestamp_pb2.Timestamp
    def __init__(self, status: _Optional[_Union[PresenceStatus, str]] = ..., last_active: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., status_emoji: _Optional[str] = ..., status_text: _Optional[str] = ..., status_expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class SetCustomStatusRequest(_message.Message):
    __slots__ = ("emoji", "text", "expires_at")
    EMOJI_FIELD_NUMBER: _ClassVar[int]
    TEXT_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    emoji: str
    text: str
    expires_at: _timestamp_pb2.Timestamp
    def __init__(self, emoji: _Optional[str] = ..., text: _Optional[str] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class SetCustomStatusResponse(_message.Message):
    __slots__ = ("presence",)
    PRESENCE_FIELD_NUMBER: _ClassVar[int]
    presence: UserPresence
    def __init__(self, presence: _Optional[_Union[UserPresence, _Mapping]] = ...) -> None: ...

class ClearCustomStatusRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class ClearCustomStatusResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...
