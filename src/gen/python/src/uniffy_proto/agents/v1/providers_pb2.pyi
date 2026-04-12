import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from common.v1 import common_pb2 as _common_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class CredentialType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    CREDENTIAL_TYPE_UNSPECIFIED: _ClassVar[CredentialType]
    CREDENTIAL_TYPE_API_KEY: _ClassVar[CredentialType]
    CREDENTIAL_TYPE_SETUP_TOKEN: _ClassVar[CredentialType]
CREDENTIAL_TYPE_UNSPECIFIED: CredentialType
CREDENTIAL_TYPE_API_KEY: CredentialType
CREDENTIAL_TYPE_SETUP_TOKEN: CredentialType

class ProviderKeyInfo(_message.Message):
    __slots__ = ("id", "provider", "credential_type", "label", "key_hint", "is_valid", "last_validated_at", "last_used_at", "last_error", "created_at", "updated_at", "is_enabled", "created_by", "access_mode", "baseline_role")
    ID_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    CREDENTIAL_TYPE_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    KEY_HINT_FIELD_NUMBER: _ClassVar[int]
    IS_VALID_FIELD_NUMBER: _ClassVar[int]
    LAST_VALIDATED_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_USED_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_ERROR_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    IS_ENABLED_FIELD_NUMBER: _ClassVar[int]
    CREATED_BY_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    id: str
    provider: str
    credential_type: CredentialType
    label: str
    key_hint: str
    is_valid: bool
    last_validated_at: _timestamp_pb2.Timestamp
    last_used_at: _timestamp_pb2.Timestamp
    last_error: str
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    is_enabled: bool
    created_by: str
    access_mode: _common_pb2.AccessMode
    baseline_role: _common_pb2.ContentRole
    def __init__(self, id: _Optional[str] = ..., provider: _Optional[str] = ..., credential_type: _Optional[_Union[CredentialType, str]] = ..., label: _Optional[str] = ..., key_hint: _Optional[str] = ..., is_valid: _Optional[bool] = ..., last_validated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., last_used_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., last_error: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., is_enabled: _Optional[bool] = ..., created_by: _Optional[str] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ...) -> None: ...

class ModelInfo(_message.Message):
    __slots__ = ("id", "display_name", "provider", "context_window", "supports_tools", "supports_vision", "supports_thinking")
    ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    CONTEXT_WINDOW_FIELD_NUMBER: _ClassVar[int]
    SUPPORTS_TOOLS_FIELD_NUMBER: _ClassVar[int]
    SUPPORTS_VISION_FIELD_NUMBER: _ClassVar[int]
    SUPPORTS_THINKING_FIELD_NUMBER: _ClassVar[int]
    id: str
    display_name: str
    provider: str
    context_window: int
    supports_tools: bool
    supports_vision: bool
    supports_thinking: bool
    def __init__(self, id: _Optional[str] = ..., display_name: _Optional[str] = ..., provider: _Optional[str] = ..., context_window: _Optional[int] = ..., supports_tools: _Optional[bool] = ..., supports_vision: _Optional[bool] = ..., supports_thinking: _Optional[bool] = ...) -> None: ...

class AddProviderKeyRequest(_message.Message):
    __slots__ = ("organization_id", "provider", "credential_type", "label", "credential", "access_mode", "baseline_role")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    CREDENTIAL_TYPE_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    CREDENTIAL_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    provider: str
    credential_type: CredentialType
    label: str
    credential: str
    access_mode: _common_pb2.AccessMode
    baseline_role: _common_pb2.ContentRole
    def __init__(self, organization_id: _Optional[str] = ..., provider: _Optional[str] = ..., credential_type: _Optional[_Union[CredentialType, str]] = ..., label: _Optional[str] = ..., credential: _Optional[str] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ...) -> None: ...

class ProviderKeyResponse(_message.Message):
    __slots__ = ("key",)
    KEY_FIELD_NUMBER: _ClassVar[int]
    key: ProviderKeyInfo
    def __init__(self, key: _Optional[_Union[ProviderKeyInfo, _Mapping]] = ...) -> None: ...

class ListProviderKeysRequest(_message.Message):
    __slots__ = ("organization_id", "provider")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    provider: str
    def __init__(self, organization_id: _Optional[str] = ..., provider: _Optional[str] = ...) -> None: ...

class ListProviderKeysResponse(_message.Message):
    __slots__ = ("keys",)
    KEYS_FIELD_NUMBER: _ClassVar[int]
    keys: _containers.RepeatedCompositeFieldContainer[ProviderKeyInfo]
    def __init__(self, keys: _Optional[_Iterable[_Union[ProviderKeyInfo, _Mapping]]] = ...) -> None: ...

class RemoveProviderKeyRequest(_message.Message):
    __slots__ = ("organization_id", "key_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    KEY_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    key_id: str
    def __init__(self, organization_id: _Optional[str] = ..., key_id: _Optional[str] = ...) -> None: ...

class RemoveProviderKeyResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class ValidateProviderKeyRequest(_message.Message):
    __slots__ = ("organization_id", "key_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    KEY_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    key_id: str
    def __init__(self, organization_id: _Optional[str] = ..., key_id: _Optional[str] = ...) -> None: ...

class ValidateProviderKeyResponse(_message.Message):
    __slots__ = ("is_valid", "error")
    IS_VALID_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    is_valid: bool
    error: str
    def __init__(self, is_valid: _Optional[bool] = ..., error: _Optional[str] = ...) -> None: ...

class ListAvailableModelsRequest(_message.Message):
    __slots__ = ("organization_id", "provider", "force_refresh")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    FORCE_REFRESH_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    provider: str
    force_refresh: bool
    def __init__(self, organization_id: _Optional[str] = ..., provider: _Optional[str] = ..., force_refresh: _Optional[bool] = ...) -> None: ...

class ListAvailableModelsResponse(_message.Message):
    __slots__ = ("models",)
    MODELS_FIELD_NUMBER: _ClassVar[int]
    models: _containers.RepeatedCompositeFieldContainer[ModelInfo]
    def __init__(self, models: _Optional[_Iterable[_Union[ModelInfo, _Mapping]]] = ...) -> None: ...

class ListModelsForKeyRequest(_message.Message):
    __slots__ = ("organization_id", "key_id", "force_refresh")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    KEY_ID_FIELD_NUMBER: _ClassVar[int]
    FORCE_REFRESH_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    key_id: str
    force_refresh: bool
    def __init__(self, organization_id: _Optional[str] = ..., key_id: _Optional[str] = ..., force_refresh: _Optional[bool] = ...) -> None: ...

class ToggleProviderKeyRequest(_message.Message):
    __slots__ = ("organization_id", "key_id", "enabled")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    KEY_ID_FIELD_NUMBER: _ClassVar[int]
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    key_id: str
    enabled: bool
    def __init__(self, organization_id: _Optional[str] = ..., key_id: _Optional[str] = ..., enabled: _Optional[bool] = ...) -> None: ...
