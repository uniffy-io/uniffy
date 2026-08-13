import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ResetUserMfaRequest(_message.Message):
    __slots__ = ("target_user_id", "reason")
    TARGET_USER_ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    target_user_id: str
    reason: str
    def __init__(self, target_user_id: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class ResetUserMfaResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class RequestPeerResetRequest(_message.Message):
    __slots__ = ("target_user_id", "reason")
    TARGET_USER_ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    target_user_id: str
    reason: str
    def __init__(self, target_user_id: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class RequestPeerResetResponse(_message.Message):
    __slots__ = ("request_id", "expires_at")
    REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    request_id: str
    expires_at: _timestamp_pb2.Timestamp
    def __init__(self, request_id: _Optional[str] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ApprovePeerResetRequest(_message.Message):
    __slots__ = ("request_id",)
    REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    request_id: str
    def __init__(self, request_id: _Optional[str] = ...) -> None: ...

class ApprovePeerResetResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class PendingPeerReset(_message.Message):
    __slots__ = ("request_id", "requester_user_id", "requester_email", "target_user_id", "target_email", "reason", "created_at", "expires_at")
    REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    REQUESTER_USER_ID_FIELD_NUMBER: _ClassVar[int]
    REQUESTER_EMAIL_FIELD_NUMBER: _ClassVar[int]
    TARGET_USER_ID_FIELD_NUMBER: _ClassVar[int]
    TARGET_EMAIL_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    request_id: str
    requester_user_id: str
    requester_email: str
    target_user_id: str
    target_email: str
    reason: str
    created_at: _timestamp_pb2.Timestamp
    expires_at: _timestamp_pb2.Timestamp
    def __init__(self, request_id: _Optional[str] = ..., requester_user_id: _Optional[str] = ..., requester_email: _Optional[str] = ..., target_user_id: _Optional[str] = ..., target_email: _Optional[str] = ..., reason: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ListPeerResetsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class ListPeerResetsResponse(_message.Message):
    __slots__ = ("requests",)
    REQUESTS_FIELD_NUMBER: _ClassVar[int]
    requests: _containers.RepeatedCompositeFieldContainer[PendingPeerReset]
    def __init__(self, requests: _Optional[_Iterable[_Union[PendingPeerReset, _Mapping]]] = ...) -> None: ...
