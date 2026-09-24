import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class OrgMailConfigView(_message.Message):
    __slots__ = ("from_address", "from_name", "reply_to", "smtp_host", "smtp_port", "smtp_username", "smtp_password_set", "smtp_use_tls", "rate_limit_per_min", "has_org_config", "effective_source", "verified_at", "last_test_at", "last_test_status", "last_test_error")
    FROM_ADDRESS_FIELD_NUMBER: _ClassVar[int]
    FROM_NAME_FIELD_NUMBER: _ClassVar[int]
    REPLY_TO_FIELD_NUMBER: _ClassVar[int]
    SMTP_HOST_FIELD_NUMBER: _ClassVar[int]
    SMTP_PORT_FIELD_NUMBER: _ClassVar[int]
    SMTP_USERNAME_FIELD_NUMBER: _ClassVar[int]
    SMTP_PASSWORD_SET_FIELD_NUMBER: _ClassVar[int]
    SMTP_USE_TLS_FIELD_NUMBER: _ClassVar[int]
    RATE_LIMIT_PER_MIN_FIELD_NUMBER: _ClassVar[int]
    HAS_ORG_CONFIG_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_SOURCE_FIELD_NUMBER: _ClassVar[int]
    VERIFIED_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_TEST_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_TEST_STATUS_FIELD_NUMBER: _ClassVar[int]
    LAST_TEST_ERROR_FIELD_NUMBER: _ClassVar[int]
    from_address: str
    from_name: str
    reply_to: str
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password_set: bool
    smtp_use_tls: bool
    rate_limit_per_min: int
    has_org_config: bool
    effective_source: str
    verified_at: _timestamp_pb2.Timestamp
    last_test_at: _timestamp_pb2.Timestamp
    last_test_status: str
    last_test_error: str
    def __init__(self, from_address: _Optional[str] = ..., from_name: _Optional[str] = ..., reply_to: _Optional[str] = ..., smtp_host: _Optional[str] = ..., smtp_port: _Optional[int] = ..., smtp_username: _Optional[str] = ..., smtp_password_set: _Optional[bool] = ..., smtp_use_tls: _Optional[bool] = ..., rate_limit_per_min: _Optional[int] = ..., has_org_config: _Optional[bool] = ..., effective_source: _Optional[str] = ..., verified_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., last_test_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., last_test_status: _Optional[str] = ..., last_test_error: _Optional[str] = ...) -> None: ...

class GetMailConfigRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class GetMailConfigResponse(_message.Message):
    __slots__ = ("config",)
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    config: OrgMailConfigView
    def __init__(self, config: _Optional[_Union[OrgMailConfigView, _Mapping]] = ...) -> None: ...

class UpdateMailConfigRequest(_message.Message):
    __slots__ = ("organization_id", "from_address", "from_name", "reply_to", "smtp_host", "smtp_port", "smtp_username", "smtp_password", "smtp_use_tls", "rate_limit_per_min")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    FROM_ADDRESS_FIELD_NUMBER: _ClassVar[int]
    FROM_NAME_FIELD_NUMBER: _ClassVar[int]
    REPLY_TO_FIELD_NUMBER: _ClassVar[int]
    SMTP_HOST_FIELD_NUMBER: _ClassVar[int]
    SMTP_PORT_FIELD_NUMBER: _ClassVar[int]
    SMTP_USERNAME_FIELD_NUMBER: _ClassVar[int]
    SMTP_PASSWORD_FIELD_NUMBER: _ClassVar[int]
    SMTP_USE_TLS_FIELD_NUMBER: _ClassVar[int]
    RATE_LIMIT_PER_MIN_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    from_address: str
    from_name: str
    reply_to: str
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password: str
    smtp_use_tls: bool
    rate_limit_per_min: int
    def __init__(self, organization_id: _Optional[str] = ..., from_address: _Optional[str] = ..., from_name: _Optional[str] = ..., reply_to: _Optional[str] = ..., smtp_host: _Optional[str] = ..., smtp_port: _Optional[int] = ..., smtp_username: _Optional[str] = ..., smtp_password: _Optional[str] = ..., smtp_use_tls: _Optional[bool] = ..., rate_limit_per_min: _Optional[int] = ...) -> None: ...

class UpdateMailConfigResponse(_message.Message):
    __slots__ = ("config",)
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    config: OrgMailConfigView
    def __init__(self, config: _Optional[_Union[OrgMailConfigView, _Mapping]] = ...) -> None: ...

class ClearMailConfigRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class ClearMailConfigResponse(_message.Message):
    __slots__ = ("deleted_keys",)
    DELETED_KEYS_FIELD_NUMBER: _ClassVar[int]
    deleted_keys: int
    def __init__(self, deleted_keys: _Optional[int] = ...) -> None: ...

class SendTestMailRequest(_message.Message):
    __slots__ = ("organization_id", "recipient_email")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    RECIPIENT_EMAIL_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    recipient_email: str
    def __init__(self, organization_id: _Optional[str] = ..., recipient_email: _Optional[str] = ...) -> None: ...

class SendTestMailResponse(_message.Message):
    __slots__ = ("success", "status", "provider_message_id", "error")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    success: bool
    status: str
    provider_message_id: str
    error: str
    def __init__(self, success: _Optional[bool] = ..., status: _Optional[str] = ..., provider_message_id: _Optional[str] = ..., error: _Optional[str] = ...) -> None: ...
