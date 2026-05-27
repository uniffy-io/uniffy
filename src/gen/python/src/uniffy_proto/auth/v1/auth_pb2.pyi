import datetime

from common.v1 import common_pb2 as _common_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class RegisterRequest(_message.Message):
    __slots__ = ("email", "username", "password", "full_name", "organization_slug")
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    USERNAME_FIELD_NUMBER: _ClassVar[int]
    PASSWORD_FIELD_NUMBER: _ClassVar[int]
    FULL_NAME_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_SLUG_FIELD_NUMBER: _ClassVar[int]
    email: str
    username: str
    password: str
    full_name: str
    organization_slug: str
    def __init__(self, email: _Optional[str] = ..., username: _Optional[str] = ..., password: _Optional[str] = ..., full_name: _Optional[str] = ..., organization_slug: _Optional[str] = ...) -> None: ...

class LoginRequest(_message.Message):
    __slots__ = ("email", "password", "organization_slug")
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    PASSWORD_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_SLUG_FIELD_NUMBER: _ClassVar[int]
    email: str
    password: str
    organization_slug: str
    def __init__(self, email: _Optional[str] = ..., password: _Optional[str] = ..., organization_slug: _Optional[str] = ...) -> None: ...

class RefreshTokenRequest(_message.Message):
    __slots__ = ("refresh_token", "organization_slug")
    REFRESH_TOKEN_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_SLUG_FIELD_NUMBER: _ClassVar[int]
    refresh_token: str
    organization_slug: str
    def __init__(self, refresh_token: _Optional[str] = ..., organization_slug: _Optional[str] = ...) -> None: ...

class GetCurrentUserRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class LogoutRequest(_message.Message):
    __slots__ = ("refresh_token",)
    REFRESH_TOKEN_FIELD_NUMBER: _ClassVar[int]
    refresh_token: str
    def __init__(self, refresh_token: _Optional[str] = ...) -> None: ...

class ListSessionsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class RevokeSessionRequest(_message.Message):
    __slots__ = ("session_id",)
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    def __init__(self, session_id: _Optional[str] = ...) -> None: ...

class RevokeOtherSessionsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class RegisterResponse(_message.Message):
    __slots__ = ("access_token", "refresh_token", "token_type", "user_id", "organization_id", "organization_role", "session_id", "domain_admin_domains")
    ACCESS_TOKEN_FIELD_NUMBER: _ClassVar[int]
    REFRESH_TOKEN_FIELD_NUMBER: _ClassVar[int]
    TOKEN_TYPE_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ROLE_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    DOMAIN_ADMIN_DOMAINS_FIELD_NUMBER: _ClassVar[int]
    access_token: str
    refresh_token: str
    token_type: str
    user_id: str
    organization_id: str
    organization_role: str
    session_id: str
    domain_admin_domains: _containers.RepeatedScalarFieldContainer[_common_pb2.DomainType]
    def __init__(self, access_token: _Optional[str] = ..., refresh_token: _Optional[str] = ..., token_type: _Optional[str] = ..., user_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., organization_role: _Optional[str] = ..., session_id: _Optional[str] = ..., domain_admin_domains: _Optional[_Iterable[_Union[_common_pb2.DomainType, str]]] = ...) -> None: ...

class LoginResponse(_message.Message):
    __slots__ = ("auth_result", "mfa_challenge", "enrollment_required")
    AUTH_RESULT_FIELD_NUMBER: _ClassVar[int]
    MFA_CHALLENGE_FIELD_NUMBER: _ClassVar[int]
    ENROLLMENT_REQUIRED_FIELD_NUMBER: _ClassVar[int]
    auth_result: AuthResult
    mfa_challenge: MfaChallenge
    enrollment_required: EnrollmentRequired
    def __init__(self, auth_result: _Optional[_Union[AuthResult, _Mapping]] = ..., mfa_challenge: _Optional[_Union[MfaChallenge, _Mapping]] = ..., enrollment_required: _Optional[_Union[EnrollmentRequired, _Mapping]] = ...) -> None: ...

class AuthResult(_message.Message):
    __slots__ = ("access_token", "refresh_token", "token_type", "user_id", "organization_id", "organization_role", "session_id", "domain_admin_domains")
    ACCESS_TOKEN_FIELD_NUMBER: _ClassVar[int]
    REFRESH_TOKEN_FIELD_NUMBER: _ClassVar[int]
    TOKEN_TYPE_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ROLE_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    DOMAIN_ADMIN_DOMAINS_FIELD_NUMBER: _ClassVar[int]
    access_token: str
    refresh_token: str
    token_type: str
    user_id: str
    organization_id: str
    organization_role: str
    session_id: str
    domain_admin_domains: _containers.RepeatedScalarFieldContainer[_common_pb2.DomainType]
    def __init__(self, access_token: _Optional[str] = ..., refresh_token: _Optional[str] = ..., token_type: _Optional[str] = ..., user_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., organization_role: _Optional[str] = ..., session_id: _Optional[str] = ..., domain_admin_domains: _Optional[_Iterable[_Union[_common_pb2.DomainType, str]]] = ...) -> None: ...

class MfaChallenge(_message.Message):
    __slots__ = ("challenge_token", "methods")
    CHALLENGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    METHODS_FIELD_NUMBER: _ClassVar[int]
    challenge_token: str
    methods: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, challenge_token: _Optional[str] = ..., methods: _Optional[_Iterable[str]] = ...) -> None: ...

class EnrollmentRequired(_message.Message):
    __slots__ = ("enrollment_token", "grace_expires_at")
    ENROLLMENT_TOKEN_FIELD_NUMBER: _ClassVar[int]
    GRACE_EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    enrollment_token: str
    grace_expires_at: _timestamp_pb2.Timestamp
    def __init__(self, enrollment_token: _Optional[str] = ..., grace_expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class RefreshTokenResponse(_message.Message):
    __slots__ = ("access_token", "refresh_token", "token_type", "user_id", "organization_id", "organization_role", "session_id", "domain_admin_domains")
    ACCESS_TOKEN_FIELD_NUMBER: _ClassVar[int]
    REFRESH_TOKEN_FIELD_NUMBER: _ClassVar[int]
    TOKEN_TYPE_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ROLE_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    DOMAIN_ADMIN_DOMAINS_FIELD_NUMBER: _ClassVar[int]
    access_token: str
    refresh_token: str
    token_type: str
    user_id: str
    organization_id: str
    organization_role: str
    session_id: str
    domain_admin_domains: _containers.RepeatedScalarFieldContainer[_common_pb2.DomainType]
    def __init__(self, access_token: _Optional[str] = ..., refresh_token: _Optional[str] = ..., token_type: _Optional[str] = ..., user_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., organization_role: _Optional[str] = ..., session_id: _Optional[str] = ..., domain_admin_domains: _Optional[_Iterable[_Union[_common_pb2.DomainType, str]]] = ...) -> None: ...

class GetCurrentUserResponse(_message.Message):
    __slots__ = ("id", "email", "username", "full_name", "is_active", "is_system_admin", "email_verified", "accent_color", "font_family", "avatar_url", "has_avatar")
    ID_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    USERNAME_FIELD_NUMBER: _ClassVar[int]
    FULL_NAME_FIELD_NUMBER: _ClassVar[int]
    IS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    IS_SYSTEM_ADMIN_FIELD_NUMBER: _ClassVar[int]
    EMAIL_VERIFIED_FIELD_NUMBER: _ClassVar[int]
    ACCENT_COLOR_FIELD_NUMBER: _ClassVar[int]
    FONT_FAMILY_FIELD_NUMBER: _ClassVar[int]
    AVATAR_URL_FIELD_NUMBER: _ClassVar[int]
    HAS_AVATAR_FIELD_NUMBER: _ClassVar[int]
    id: str
    email: str
    username: str
    full_name: str
    is_active: bool
    is_system_admin: bool
    email_verified: bool
    accent_color: str
    font_family: str
    avatar_url: str
    has_avatar: bool
    def __init__(self, id: _Optional[str] = ..., email: _Optional[str] = ..., username: _Optional[str] = ..., full_name: _Optional[str] = ..., is_active: _Optional[bool] = ..., is_system_admin: _Optional[bool] = ..., email_verified: _Optional[bool] = ..., accent_color: _Optional[str] = ..., font_family: _Optional[str] = ..., avatar_url: _Optional[str] = ..., has_avatar: _Optional[bool] = ...) -> None: ...

class LogoutResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class SessionInfo(_message.Message):
    __slots__ = ("id", "user_agent", "device_label", "created_at", "last_activity", "is_current")
    ID_FIELD_NUMBER: _ClassVar[int]
    USER_AGENT_FIELD_NUMBER: _ClassVar[int]
    DEVICE_LABEL_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_ACTIVITY_FIELD_NUMBER: _ClassVar[int]
    IS_CURRENT_FIELD_NUMBER: _ClassVar[int]
    id: str
    user_agent: str
    device_label: str
    created_at: str
    last_activity: str
    is_current: bool
    def __init__(self, id: _Optional[str] = ..., user_agent: _Optional[str] = ..., device_label: _Optional[str] = ..., created_at: _Optional[str] = ..., last_activity: _Optional[str] = ..., is_current: _Optional[bool] = ...) -> None: ...

class ListSessionsResponse(_message.Message):
    __slots__ = ("sessions",)
    SESSIONS_FIELD_NUMBER: _ClassVar[int]
    sessions: _containers.RepeatedCompositeFieldContainer[SessionInfo]
    def __init__(self, sessions: _Optional[_Iterable[_Union[SessionInfo, _Mapping]]] = ...) -> None: ...

class RevokeSessionResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class RevokeOtherSessionsResponse(_message.Message):
    __slots__ = ("revoked_count",)
    REVOKED_COUNT_FIELD_NUMBER: _ClassVar[int]
    revoked_count: int
    def __init__(self, revoked_count: _Optional[int] = ...) -> None: ...

class GetCacheKeySeedRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetCacheKeySeedResponse(_message.Message):
    __slots__ = ("cache_key_seed",)
    CACHE_KEY_SEED_FIELD_NUMBER: _ClassVar[int]
    cache_key_seed: bytes
    def __init__(self, cache_key_seed: _Optional[bytes] = ...) -> None: ...

class RotateCacheKeySeedRequest(_message.Message):
    __slots__ = ("target_user_id",)
    TARGET_USER_ID_FIELD_NUMBER: _ClassVar[int]
    target_user_id: str
    def __init__(self, target_user_id: _Optional[str] = ...) -> None: ...

class RotateCacheKeySeedResponse(_message.Message):
    __slots__ = ("new_cache_key_seed",)
    NEW_CACHE_KEY_SEED_FIELD_NUMBER: _ClassVar[int]
    new_cache_key_seed: bytes
    def __init__(self, new_cache_key_seed: _Optional[bytes] = ...) -> None: ...

class GetAuthConfigRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetAuthConfigResponse(_message.Message):
    __slots__ = ("public_registration_enabled",)
    PUBLIC_REGISTRATION_ENABLED_FIELD_NUMBER: _ClassVar[int]
    public_registration_enabled: bool
    def __init__(self, public_registration_enabled: _Optional[bool] = ...) -> None: ...

class GetInvitationRequest(_message.Message):
    __slots__ = ("token",)
    TOKEN_FIELD_NUMBER: _ClassVar[int]
    token: str
    def __init__(self, token: _Optional[str] = ...) -> None: ...

class GetInvitationResponse(_message.Message):
    __slots__ = ("email", "organization_id", "organization_name", "organization_slug", "inviter_display_name", "role", "expires_at")
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_NAME_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_SLUG_FIELD_NUMBER: _ClassVar[int]
    INVITER_DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    email: str
    organization_id: str
    organization_name: str
    organization_slug: str
    inviter_display_name: str
    role: _common_pb2.OrganizationRole
    expires_at: _timestamp_pb2.Timestamp
    def __init__(self, email: _Optional[str] = ..., organization_id: _Optional[str] = ..., organization_name: _Optional[str] = ..., organization_slug: _Optional[str] = ..., inviter_display_name: _Optional[str] = ..., role: _Optional[_Union[_common_pb2.OrganizationRole, str]] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class AcceptInvitationRequest(_message.Message):
    __slots__ = ("token", "username", "password", "full_name")
    TOKEN_FIELD_NUMBER: _ClassVar[int]
    USERNAME_FIELD_NUMBER: _ClassVar[int]
    PASSWORD_FIELD_NUMBER: _ClassVar[int]
    FULL_NAME_FIELD_NUMBER: _ClassVar[int]
    token: str
    username: str
    password: str
    full_name: str
    def __init__(self, token: _Optional[str] = ..., username: _Optional[str] = ..., password: _Optional[str] = ..., full_name: _Optional[str] = ...) -> None: ...

class AcceptInvitationResponse(_message.Message):
    __slots__ = ("access_token", "refresh_token", "token_type", "user_id", "organization_id", "organization_role", "session_id", "domain_admin_domains")
    ACCESS_TOKEN_FIELD_NUMBER: _ClassVar[int]
    REFRESH_TOKEN_FIELD_NUMBER: _ClassVar[int]
    TOKEN_TYPE_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ROLE_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    DOMAIN_ADMIN_DOMAINS_FIELD_NUMBER: _ClassVar[int]
    access_token: str
    refresh_token: str
    token_type: str
    user_id: str
    organization_id: str
    organization_role: str
    session_id: str
    domain_admin_domains: _containers.RepeatedScalarFieldContainer[_common_pb2.DomainType]
    def __init__(self, access_token: _Optional[str] = ..., refresh_token: _Optional[str] = ..., token_type: _Optional[str] = ..., user_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., organization_role: _Optional[str] = ..., session_id: _Optional[str] = ..., domain_admin_domains: _Optional[_Iterable[_Union[_common_pb2.DomainType, str]]] = ...) -> None: ...

class SendPasswordResetRequest(_message.Message):
    __slots__ = ("email",)
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    email: str
    def __init__(self, email: _Optional[str] = ...) -> None: ...

class SendPasswordResetResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class VerifyPasswordResetTokenRequest(_message.Message):
    __slots__ = ("token",)
    TOKEN_FIELD_NUMBER: _ClassVar[int]
    token: str
    def __init__(self, token: _Optional[str] = ...) -> None: ...

class VerifyPasswordResetTokenResponse(_message.Message):
    __slots__ = ("email", "expires_at")
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    email: str
    expires_at: _timestamp_pb2.Timestamp
    def __init__(self, email: _Optional[str] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ResetPasswordRequest(_message.Message):
    __slots__ = ("token", "new_password")
    TOKEN_FIELD_NUMBER: _ClassVar[int]
    NEW_PASSWORD_FIELD_NUMBER: _ClassVar[int]
    token: str
    new_password: str
    def __init__(self, token: _Optional[str] = ..., new_password: _Optional[str] = ...) -> None: ...

class ResetPasswordResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...
