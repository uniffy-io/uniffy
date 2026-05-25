from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SystemFlag(_message.Message):
    __slots__ = ("enabled", "source")
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    enabled: bool
    source: str
    def __init__(self, enabled: _Optional[bool] = ..., source: _Optional[str] = ...) -> None: ...

class SystemConfig(_message.Message):
    __slots__ = ("public_registration",)
    PUBLIC_REGISTRATION_FIELD_NUMBER: _ClassVar[int]
    public_registration: SystemFlag
    def __init__(self, public_registration: _Optional[_Union[SystemFlag, _Mapping]] = ...) -> None: ...

class GetSystemConfigRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetSystemConfigResponse(_message.Message):
    __slots__ = ("config",)
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    config: SystemConfig
    def __init__(self, config: _Optional[_Union[SystemConfig, _Mapping]] = ...) -> None: ...

class SetPublicRegistrationRequest(_message.Message):
    __slots__ = ("enabled",)
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    enabled: bool
    def __init__(self, enabled: _Optional[bool] = ...) -> None: ...

class SetPublicRegistrationResponse(_message.Message):
    __slots__ = ("config",)
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    config: SystemConfig
    def __init__(self, config: _Optional[_Union[SystemConfig, _Mapping]] = ...) -> None: ...
