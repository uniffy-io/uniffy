import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class IntegrationProviderInfo(_message.Message):
    __slots__ = ("id", "label", "default_base_url", "credential_placeholder", "credential_docs_url", "supports_base_url_override")
    ID_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_BASE_URL_FIELD_NUMBER: _ClassVar[int]
    CREDENTIAL_PLACEHOLDER_FIELD_NUMBER: _ClassVar[int]
    CREDENTIAL_DOCS_URL_FIELD_NUMBER: _ClassVar[int]
    SUPPORTS_BASE_URL_OVERRIDE_FIELD_NUMBER: _ClassVar[int]
    id: str
    label: str
    default_base_url: str
    credential_placeholder: str
    credential_docs_url: str
    supports_base_url_override: bool
    def __init__(self, id: _Optional[str] = ..., label: _Optional[str] = ..., default_base_url: _Optional[str] = ..., credential_placeholder: _Optional[str] = ..., credential_docs_url: _Optional[str] = ..., supports_base_url_override: _Optional[bool] = ...) -> None: ...

class IntegrationConnectionInfo(_message.Message):
    __slots__ = ("id", "provider", "name", "base_url", "credential_hint", "account_login", "allow_writes", "is_valid", "is_enabled", "last_validated_at", "last_used_at", "last_error", "created_by", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    BASE_URL_FIELD_NUMBER: _ClassVar[int]
    CREDENTIAL_HINT_FIELD_NUMBER: _ClassVar[int]
    ACCOUNT_LOGIN_FIELD_NUMBER: _ClassVar[int]
    ALLOW_WRITES_FIELD_NUMBER: _ClassVar[int]
    IS_VALID_FIELD_NUMBER: _ClassVar[int]
    IS_ENABLED_FIELD_NUMBER: _ClassVar[int]
    LAST_VALIDATED_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_USED_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_ERROR_FIELD_NUMBER: _ClassVar[int]
    CREATED_BY_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    provider: str
    name: str
    base_url: str
    credential_hint: str
    account_login: str
    allow_writes: bool
    is_valid: bool
    is_enabled: bool
    last_validated_at: _timestamp_pb2.Timestamp
    last_used_at: _timestamp_pb2.Timestamp
    last_error: str
    created_by: str
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., provider: _Optional[str] = ..., name: _Optional[str] = ..., base_url: _Optional[str] = ..., credential_hint: _Optional[str] = ..., account_login: _Optional[str] = ..., allow_writes: _Optional[bool] = ..., is_valid: _Optional[bool] = ..., is_enabled: _Optional[bool] = ..., last_validated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., last_used_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., last_error: _Optional[str] = ..., created_by: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ListIntegrationProvidersRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class ListIntegrationProvidersResponse(_message.Message):
    __slots__ = ("providers",)
    PROVIDERS_FIELD_NUMBER: _ClassVar[int]
    providers: _containers.RepeatedCompositeFieldContainer[IntegrationProviderInfo]
    def __init__(self, providers: _Optional[_Iterable[_Union[IntegrationProviderInfo, _Mapping]]] = ...) -> None: ...

class ListConnectionsRequest(_message.Message):
    __slots__ = ("organization_id", "provider")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    provider: str
    def __init__(self, organization_id: _Optional[str] = ..., provider: _Optional[str] = ...) -> None: ...

class ListConnectionsResponse(_message.Message):
    __slots__ = ("connections",)
    CONNECTIONS_FIELD_NUMBER: _ClassVar[int]
    connections: _containers.RepeatedCompositeFieldContainer[IntegrationConnectionInfo]
    def __init__(self, connections: _Optional[_Iterable[_Union[IntegrationConnectionInfo, _Mapping]]] = ...) -> None: ...

class AddConnectionRequest(_message.Message):
    __slots__ = ("organization_id", "provider", "name", "credential", "base_url", "allow_writes")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    CREDENTIAL_FIELD_NUMBER: _ClassVar[int]
    BASE_URL_FIELD_NUMBER: _ClassVar[int]
    ALLOW_WRITES_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    provider: str
    name: str
    credential: str
    base_url: str
    allow_writes: bool
    def __init__(self, organization_id: _Optional[str] = ..., provider: _Optional[str] = ..., name: _Optional[str] = ..., credential: _Optional[str] = ..., base_url: _Optional[str] = ..., allow_writes: _Optional[bool] = ...) -> None: ...

class AddConnectionResponse(_message.Message):
    __slots__ = ("connection",)
    CONNECTION_FIELD_NUMBER: _ClassVar[int]
    connection: IntegrationConnectionInfo
    def __init__(self, connection: _Optional[_Union[IntegrationConnectionInfo, _Mapping]] = ...) -> None: ...

class UpdateConnectionRequest(_message.Message):
    __slots__ = ("connection_id", "organization_id", "name", "base_url", "allow_writes", "credential")
    CONNECTION_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    BASE_URL_FIELD_NUMBER: _ClassVar[int]
    ALLOW_WRITES_FIELD_NUMBER: _ClassVar[int]
    CREDENTIAL_FIELD_NUMBER: _ClassVar[int]
    connection_id: str
    organization_id: str
    name: str
    base_url: str
    allow_writes: bool
    credential: str
    def __init__(self, connection_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., name: _Optional[str] = ..., base_url: _Optional[str] = ..., allow_writes: _Optional[bool] = ..., credential: _Optional[str] = ...) -> None: ...

class UpdateConnectionResponse(_message.Message):
    __slots__ = ("connection",)
    CONNECTION_FIELD_NUMBER: _ClassVar[int]
    connection: IntegrationConnectionInfo
    def __init__(self, connection: _Optional[_Union[IntegrationConnectionInfo, _Mapping]] = ...) -> None: ...

class RemoveConnectionRequest(_message.Message):
    __slots__ = ("organization_id", "connection_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONNECTION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    connection_id: str
    def __init__(self, organization_id: _Optional[str] = ..., connection_id: _Optional[str] = ...) -> None: ...

class RemoveConnectionResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class ValidateConnectionRequest(_message.Message):
    __slots__ = ("organization_id", "connection_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONNECTION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    connection_id: str
    def __init__(self, organization_id: _Optional[str] = ..., connection_id: _Optional[str] = ...) -> None: ...

class ValidateConnectionResponse(_message.Message):
    __slots__ = ("is_valid", "error", "account_login")
    IS_VALID_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    ACCOUNT_LOGIN_FIELD_NUMBER: _ClassVar[int]
    is_valid: bool
    error: str
    account_login: str
    def __init__(self, is_valid: _Optional[bool] = ..., error: _Optional[str] = ..., account_login: _Optional[str] = ...) -> None: ...

class ToggleConnectionRequest(_message.Message):
    __slots__ = ("organization_id", "connection_id", "enabled")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONNECTION_ID_FIELD_NUMBER: _ClassVar[int]
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    connection_id: str
    enabled: bool
    def __init__(self, organization_id: _Optional[str] = ..., connection_id: _Optional[str] = ..., enabled: _Optional[bool] = ...) -> None: ...

class ToggleConnectionResponse(_message.Message):
    __slots__ = ("connection",)
    CONNECTION_FIELD_NUMBER: _ClassVar[int]
    connection: IntegrationConnectionInfo
    def __init__(self, connection: _Optional[_Union[IntegrationConnectionInfo, _Mapping]] = ...) -> None: ...
