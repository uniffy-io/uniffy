import datetime

from common.v1 import common_pb2 as _common_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class BeginEnrollmentRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class BeginEnrollmentResponse(_message.Message):
    __slots__ = ("secret_b32", "provisioning_uri", "qr_svg_base64")
    SECRET_B32_FIELD_NUMBER: _ClassVar[int]
    PROVISIONING_URI_FIELD_NUMBER: _ClassVar[int]
    QR_SVG_BASE64_FIELD_NUMBER: _ClassVar[int]
    secret_b32: str
    provisioning_uri: str
    qr_svg_base64: str
    def __init__(self, secret_b32: _Optional[str] = ..., provisioning_uri: _Optional[str] = ..., qr_svg_base64: _Optional[str] = ...) -> None: ...

class ConfirmEnrollmentRequest(_message.Message):
    __slots__ = ("code",)
    CODE_FIELD_NUMBER: _ClassVar[int]
    code: str
    def __init__(self, code: _Optional[str] = ...) -> None: ...

class ConfirmEnrollmentResponse(_message.Message):
    __slots__ = ("recovery_codes", "access_token", "refresh_token", "session_id", "organization_id", "organization_slug", "organization_role", "domain_admin_domains", "asset_cookie")
    RECOVERY_CODES_FIELD_NUMBER: _ClassVar[int]
    ACCESS_TOKEN_FIELD_NUMBER: _ClassVar[int]
    REFRESH_TOKEN_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_SLUG_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ROLE_FIELD_NUMBER: _ClassVar[int]
    DOMAIN_ADMIN_DOMAINS_FIELD_NUMBER: _ClassVar[int]
    ASSET_COOKIE_FIELD_NUMBER: _ClassVar[int]
    recovery_codes: _containers.RepeatedScalarFieldContainer[str]
    access_token: str
    refresh_token: str
    session_id: str
    organization_id: str
    organization_slug: str
    organization_role: str
    domain_admin_domains: _containers.RepeatedScalarFieldContainer[_common_pb2.DomainType]
    asset_cookie: str
    def __init__(self, recovery_codes: _Optional[_Iterable[str]] = ..., access_token: _Optional[str] = ..., refresh_token: _Optional[str] = ..., session_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., organization_slug: _Optional[str] = ..., organization_role: _Optional[str] = ..., domain_admin_domains: _Optional[_Iterable[_Union[_common_pb2.DomainType, str]]] = ..., asset_cookie: _Optional[str] = ...) -> None: ...

class VerifyMfaRequest(_message.Message):
    __slots__ = ("challenge_token", "code", "method")
    CHALLENGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    CODE_FIELD_NUMBER: _ClassVar[int]
    METHOD_FIELD_NUMBER: _ClassVar[int]
    challenge_token: str
    code: str
    method: str
    def __init__(self, challenge_token: _Optional[str] = ..., code: _Optional[str] = ..., method: _Optional[str] = ...) -> None: ...

class VerifyMfaResponse(_message.Message):
    __slots__ = ("access_token", "refresh_token", "token_type", "user_id", "organization_id", "organization_role", "session_id", "used_recovery_code", "remaining_recovery_codes", "organization_slug", "domain_admin_domains", "asset_cookie")
    ACCESS_TOKEN_FIELD_NUMBER: _ClassVar[int]
    REFRESH_TOKEN_FIELD_NUMBER: _ClassVar[int]
    TOKEN_TYPE_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ROLE_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    USED_RECOVERY_CODE_FIELD_NUMBER: _ClassVar[int]
    REMAINING_RECOVERY_CODES_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_SLUG_FIELD_NUMBER: _ClassVar[int]
    DOMAIN_ADMIN_DOMAINS_FIELD_NUMBER: _ClassVar[int]
    ASSET_COOKIE_FIELD_NUMBER: _ClassVar[int]
    access_token: str
    refresh_token: str
    token_type: str
    user_id: str
    organization_id: str
    organization_role: str
    session_id: str
    used_recovery_code: bool
    remaining_recovery_codes: int
    organization_slug: str
    domain_admin_domains: _containers.RepeatedScalarFieldContainer[_common_pb2.DomainType]
    asset_cookie: str
    def __init__(self, access_token: _Optional[str] = ..., refresh_token: _Optional[str] = ..., token_type: _Optional[str] = ..., user_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., organization_role: _Optional[str] = ..., session_id: _Optional[str] = ..., used_recovery_code: _Optional[bool] = ..., remaining_recovery_codes: _Optional[int] = ..., organization_slug: _Optional[str] = ..., domain_admin_domains: _Optional[_Iterable[_Union[_common_pb2.DomainType, str]]] = ..., asset_cookie: _Optional[str] = ...) -> None: ...

class DisableMfaRequest(_message.Message):
    __slots__ = ("code",)
    CODE_FIELD_NUMBER: _ClassVar[int]
    code: str
    def __init__(self, code: _Optional[str] = ...) -> None: ...

class DisableMfaResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class RegenerateRecoveryCodesRequest(_message.Message):
    __slots__ = ("code",)
    CODE_FIELD_NUMBER: _ClassVar[int]
    code: str
    def __init__(self, code: _Optional[str] = ...) -> None: ...

class RegenerateRecoveryCodesResponse(_message.Message):
    __slots__ = ("recovery_codes",)
    RECOVERY_CODES_FIELD_NUMBER: _ClassVar[int]
    recovery_codes: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, recovery_codes: _Optional[_Iterable[str]] = ...) -> None: ...

class GetMfaStatusRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetMfaStatusResponse(_message.Message):
    __slots__ = ("enabled", "enrolled_at", "last_used_at", "remaining_recovery_codes")
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    ENROLLED_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_USED_AT_FIELD_NUMBER: _ClassVar[int]
    REMAINING_RECOVERY_CODES_FIELD_NUMBER: _ClassVar[int]
    enabled: bool
    enrolled_at: _timestamp_pb2.Timestamp
    last_used_at: _timestamp_pb2.Timestamp
    remaining_recovery_codes: int
    def __init__(self, enabled: _Optional[bool] = ..., enrolled_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., last_used_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., remaining_recovery_codes: _Optional[int] = ...) -> None: ...

class AdminResetMfaRequest(_message.Message):
    __slots__ = ("organization_id", "target_user_id", "reason")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TARGET_USER_ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    target_user_id: str
    reason: str
    def __init__(self, organization_id: _Optional[str] = ..., target_user_id: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class AdminResetMfaResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...
