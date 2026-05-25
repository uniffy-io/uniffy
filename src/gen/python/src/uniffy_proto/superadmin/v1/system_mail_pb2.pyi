import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SystemMailConfigView(_message.Message):
    __slots__ = ("configured", "effective_source", "from_address", "from_name", "reply_to", "smtp_host", "smtp_port", "smtp_username", "smtp_password_set", "smtp_use_tls", "rate_limit_per_min")
    CONFIGURED_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_SOURCE_FIELD_NUMBER: _ClassVar[int]
    FROM_ADDRESS_FIELD_NUMBER: _ClassVar[int]
    FROM_NAME_FIELD_NUMBER: _ClassVar[int]
    REPLY_TO_FIELD_NUMBER: _ClassVar[int]
    SMTP_HOST_FIELD_NUMBER: _ClassVar[int]
    SMTP_PORT_FIELD_NUMBER: _ClassVar[int]
    SMTP_USERNAME_FIELD_NUMBER: _ClassVar[int]
    SMTP_PASSWORD_SET_FIELD_NUMBER: _ClassVar[int]
    SMTP_USE_TLS_FIELD_NUMBER: _ClassVar[int]
    RATE_LIMIT_PER_MIN_FIELD_NUMBER: _ClassVar[int]
    configured: bool
    effective_source: str
    from_address: str
    from_name: str
    reply_to: str
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password_set: bool
    smtp_use_tls: bool
    rate_limit_per_min: int
    def __init__(self, configured: _Optional[bool] = ..., effective_source: _Optional[str] = ..., from_address: _Optional[str] = ..., from_name: _Optional[str] = ..., reply_to: _Optional[str] = ..., smtp_host: _Optional[str] = ..., smtp_port: _Optional[int] = ..., smtp_username: _Optional[str] = ..., smtp_password_set: _Optional[bool] = ..., smtp_use_tls: _Optional[bool] = ..., rate_limit_per_min: _Optional[int] = ...) -> None: ...

class GetSystemMailConfigRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetSystemMailConfigResponse(_message.Message):
    __slots__ = ("config",)
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    config: SystemMailConfigView
    def __init__(self, config: _Optional[_Union[SystemMailConfigView, _Mapping]] = ...) -> None: ...

class UpdateSystemMailConfigRequest(_message.Message):
    __slots__ = ("from_address", "from_name", "reply_to", "smtp_host", "smtp_port", "smtp_username", "smtp_password", "smtp_use_tls", "rate_limit_per_min")
    FROM_ADDRESS_FIELD_NUMBER: _ClassVar[int]
    FROM_NAME_FIELD_NUMBER: _ClassVar[int]
    REPLY_TO_FIELD_NUMBER: _ClassVar[int]
    SMTP_HOST_FIELD_NUMBER: _ClassVar[int]
    SMTP_PORT_FIELD_NUMBER: _ClassVar[int]
    SMTP_USERNAME_FIELD_NUMBER: _ClassVar[int]
    SMTP_PASSWORD_FIELD_NUMBER: _ClassVar[int]
    SMTP_USE_TLS_FIELD_NUMBER: _ClassVar[int]
    RATE_LIMIT_PER_MIN_FIELD_NUMBER: _ClassVar[int]
    from_address: str
    from_name: str
    reply_to: str
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password: str
    smtp_use_tls: bool
    rate_limit_per_min: int
    def __init__(self, from_address: _Optional[str] = ..., from_name: _Optional[str] = ..., reply_to: _Optional[str] = ..., smtp_host: _Optional[str] = ..., smtp_port: _Optional[int] = ..., smtp_username: _Optional[str] = ..., smtp_password: _Optional[str] = ..., smtp_use_tls: _Optional[bool] = ..., rate_limit_per_min: _Optional[int] = ...) -> None: ...

class UpdateSystemMailConfigResponse(_message.Message):
    __slots__ = ("config",)
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    config: SystemMailConfigView
    def __init__(self, config: _Optional[_Union[SystemMailConfigView, _Mapping]] = ...) -> None: ...

class ClearSystemMailConfigRequest(_message.Message):
    __slots__ = ("reason",)
    REASON_FIELD_NUMBER: _ClassVar[int]
    reason: str
    def __init__(self, reason: _Optional[str] = ...) -> None: ...

class ClearSystemMailConfigResponse(_message.Message):
    __slots__ = ("deleted_keys",)
    DELETED_KEYS_FIELD_NUMBER: _ClassVar[int]
    deleted_keys: int
    def __init__(self, deleted_keys: _Optional[int] = ...) -> None: ...

class OrgMailConfigSummary(_message.Message):
    __slots__ = ("organization_id", "organization_name", "organization_slug", "effective_source", "from_address", "smtp_host", "smtp_password_set", "verified_at", "last_test_at", "last_test_status")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_NAME_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_SLUG_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_SOURCE_FIELD_NUMBER: _ClassVar[int]
    FROM_ADDRESS_FIELD_NUMBER: _ClassVar[int]
    SMTP_HOST_FIELD_NUMBER: _ClassVar[int]
    SMTP_PASSWORD_SET_FIELD_NUMBER: _ClassVar[int]
    VERIFIED_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_TEST_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_TEST_STATUS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    organization_name: str
    organization_slug: str
    effective_source: str
    from_address: str
    smtp_host: str
    smtp_password_set: bool
    verified_at: _timestamp_pb2.Timestamp
    last_test_at: _timestamp_pb2.Timestamp
    last_test_status: str
    def __init__(self, organization_id: _Optional[str] = ..., organization_name: _Optional[str] = ..., organization_slug: _Optional[str] = ..., effective_source: _Optional[str] = ..., from_address: _Optional[str] = ..., smtp_host: _Optional[str] = ..., smtp_password_set: _Optional[bool] = ..., verified_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., last_test_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., last_test_status: _Optional[str] = ...) -> None: ...

class ListOrgMailConfigsRequest(_message.Message):
    __slots__ = ("page", "page_size", "search", "only_with_org_config")
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    SEARCH_FIELD_NUMBER: _ClassVar[int]
    ONLY_WITH_ORG_CONFIG_FIELD_NUMBER: _ClassVar[int]
    page: int
    page_size: int
    search: str
    only_with_org_config: bool
    def __init__(self, page: _Optional[int] = ..., page_size: _Optional[int] = ..., search: _Optional[str] = ..., only_with_org_config: _Optional[bool] = ...) -> None: ...

class ListOrgMailConfigsResponse(_message.Message):
    __slots__ = ("configs", "total_count", "page", "page_size")
    CONFIGS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    configs: _containers.RepeatedCompositeFieldContainer[OrgMailConfigSummary]
    total_count: int
    page: int
    page_size: int
    def __init__(self, configs: _Optional[_Iterable[_Union[OrgMailConfigSummary, _Mapping]]] = ..., total_count: _Optional[int] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ...) -> None: ...

class ForceClearOrgConfigRequest(_message.Message):
    __slots__ = ("organization_id", "reason")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    reason: str
    def __init__(self, organization_id: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class ForceClearOrgConfigResponse(_message.Message):
    __slots__ = ("deleted_keys",)
    DELETED_KEYS_FIELD_NUMBER: _ClassVar[int]
    deleted_keys: int
    def __init__(self, deleted_keys: _Optional[int] = ...) -> None: ...

class GlobalSuppressionEntry(_message.Message):
    __slots__ = ("id", "email", "reason", "source", "created_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    email: str
    reason: str
    source: str
    created_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., email: _Optional[str] = ..., reason: _Optional[str] = ..., source: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ListGlobalSuppressionsRequest(_message.Message):
    __slots__ = ("page", "page_size", "search")
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    SEARCH_FIELD_NUMBER: _ClassVar[int]
    page: int
    page_size: int
    search: str
    def __init__(self, page: _Optional[int] = ..., page_size: _Optional[int] = ..., search: _Optional[str] = ...) -> None: ...

class ListGlobalSuppressionsResponse(_message.Message):
    __slots__ = ("entries", "total_count", "page", "page_size")
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[GlobalSuppressionEntry]
    total_count: int
    page: int
    page_size: int
    def __init__(self, entries: _Optional[_Iterable[_Union[GlobalSuppressionEntry, _Mapping]]] = ..., total_count: _Optional[int] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ...) -> None: ...

class RemoveGlobalSuppressionRequest(_message.Message):
    __slots__ = ("email", "reason")
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    email: str
    reason: str
    def __init__(self, email: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class RemoveGlobalSuppressionResponse(_message.Message):
    __slots__ = ("removed",)
    REMOVED_FIELD_NUMBER: _ClassVar[int]
    removed: bool
    def __init__(self, removed: _Optional[bool] = ...) -> None: ...

class GlobalDeliveryEntry(_message.Message):
    __slots__ = ("id", "created_at", "action", "config_source", "organization_id", "organization_name", "recipient", "template", "provider_message_id", "error")
    ID_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    ACTION_FIELD_NUMBER: _ClassVar[int]
    CONFIG_SOURCE_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_NAME_FIELD_NUMBER: _ClassVar[int]
    RECIPIENT_FIELD_NUMBER: _ClassVar[int]
    TEMPLATE_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    id: str
    created_at: _timestamp_pb2.Timestamp
    action: str
    config_source: str
    organization_id: str
    organization_name: str
    recipient: str
    template: str
    provider_message_id: str
    error: str
    def __init__(self, id: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., action: _Optional[str] = ..., config_source: _Optional[str] = ..., organization_id: _Optional[str] = ..., organization_name: _Optional[str] = ..., recipient: _Optional[str] = ..., template: _Optional[str] = ..., provider_message_id: _Optional[str] = ..., error: _Optional[str] = ...) -> None: ...

class ListGlobalDeliveriesRequest(_message.Message):
    __slots__ = ("page", "page_size", "organization_id", "outcome")
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    OUTCOME_FIELD_NUMBER: _ClassVar[int]
    page: int
    page_size: int
    organization_id: str
    outcome: str
    def __init__(self, page: _Optional[int] = ..., page_size: _Optional[int] = ..., organization_id: _Optional[str] = ..., outcome: _Optional[str] = ...) -> None: ...

class ListGlobalDeliveriesResponse(_message.Message):
    __slots__ = ("entries", "total_count", "page", "page_size")
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[GlobalDeliveryEntry]
    total_count: int
    page: int
    page_size: int
    def __init__(self, entries: _Optional[_Iterable[_Union[GlobalDeliveryEntry, _Mapping]]] = ..., total_count: _Optional[int] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ...) -> None: ...
