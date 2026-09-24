import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class DeploymentEncryptionStatus(_message.Message):
    __slots__ = ("active_version", "active_created_at", "total_versions")
    ACTIVE_VERSION_FIELD_NUMBER: _ClassVar[int]
    ACTIVE_CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    TOTAL_VERSIONS_FIELD_NUMBER: _ClassVar[int]
    active_version: int
    active_created_at: _timestamp_pb2.Timestamp
    total_versions: int
    def __init__(self, active_version: _Optional[int] = ..., active_created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., total_versions: _Optional[int] = ...) -> None: ...

class GetDeploymentEncryptionStatusRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetDeploymentEncryptionStatusResponse(_message.Message):
    __slots__ = ("status",)
    STATUS_FIELD_NUMBER: _ClassVar[int]
    status: DeploymentEncryptionStatus
    def __init__(self, status: _Optional[_Union[DeploymentEncryptionStatus, _Mapping]] = ...) -> None: ...

class RotateDeploymentDekRequest(_message.Message):
    __slots__ = ("reason",)
    REASON_FIELD_NUMBER: _ClassVar[int]
    reason: str
    def __init__(self, reason: _Optional[str] = ...) -> None: ...

class RotateDeploymentDekResponse(_message.Message):
    __slots__ = ("new_active_version",)
    NEW_ACTIVE_VERSION_FIELD_NUMBER: _ClassVar[int]
    new_active_version: int
    def __init__(self, new_active_version: _Optional[int] = ...) -> None: ...
