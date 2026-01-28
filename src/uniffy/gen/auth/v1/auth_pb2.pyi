from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

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

class AuthResponse(_message.Message):
    __slots__ = ("access_token", "refresh_token", "token_type", "user_id", "organization_id", "organization_role")
    ACCESS_TOKEN_FIELD_NUMBER: _ClassVar[int]
    REFRESH_TOKEN_FIELD_NUMBER: _ClassVar[int]
    TOKEN_TYPE_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ROLE_FIELD_NUMBER: _ClassVar[int]
    access_token: str
    refresh_token: str
    token_type: str
    user_id: str
    organization_id: str
    organization_role: str
    def __init__(self, access_token: _Optional[str] = ..., refresh_token: _Optional[str] = ..., token_type: _Optional[str] = ..., user_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., organization_role: _Optional[str] = ...) -> None: ...

class CurrentUserResponse(_message.Message):
    __slots__ = ("id", "email", "username", "full_name", "is_active", "is_system_admin", "email_verified", "accent_color", "font_family", "avatar_url")
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
    def __init__(self, id: _Optional[str] = ..., email: _Optional[str] = ..., username: _Optional[str] = ..., full_name: _Optional[str] = ..., is_active: _Optional[bool] = ..., is_system_admin: _Optional[bool] = ..., email_verified: _Optional[bool] = ..., accent_color: _Optional[str] = ..., font_family: _Optional[str] = ..., avatar_url: _Optional[str] = ...) -> None: ...

class LogoutResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...
