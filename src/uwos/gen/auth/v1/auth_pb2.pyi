from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class RegisterRequest(_message.Message):
    __slots__ = ()
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
    __slots__ = ()
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    PASSWORD_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_SLUG_FIELD_NUMBER: _ClassVar[int]
    email: str
    password: str
    organization_slug: str
    def __init__(self, email: _Optional[str] = ..., password: _Optional[str] = ..., organization_slug: _Optional[str] = ...) -> None: ...

class RefreshTokenRequest(_message.Message):
    __slots__ = ()
    REFRESH_TOKEN_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_SLUG_FIELD_NUMBER: _ClassVar[int]
    refresh_token: str
    organization_slug: str
    def __init__(self, refresh_token: _Optional[str] = ..., organization_slug: _Optional[str] = ...) -> None: ...

class GetCurrentUserRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class AuthResponse(_message.Message):
    __slots__ = ()
    ACCESS_TOKEN_FIELD_NUMBER: _ClassVar[int]
    REFRESH_TOKEN_FIELD_NUMBER: _ClassVar[int]
    TOKEN_TYPE_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    access_token: str
    refresh_token: str
    token_type: str
    user_id: str
    organization_id: str
    def __init__(self, access_token: _Optional[str] = ..., refresh_token: _Optional[str] = ..., token_type: _Optional[str] = ..., user_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class UserInfoResponse(_message.Message):
    __slots__ = ()
    ID_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    USERNAME_FIELD_NUMBER: _ClassVar[int]
    FULL_NAME_FIELD_NUMBER: _ClassVar[int]
    IS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    IS_SYSTEM_ADMIN_FIELD_NUMBER: _ClassVar[int]
    EMAIL_VERIFIED_FIELD_NUMBER: _ClassVar[int]
    id: str
    email: str
    username: str
    full_name: str
    is_active: bool
    is_system_admin: bool
    email_verified: bool
    def __init__(self, id: _Optional[str] = ..., email: _Optional[str] = ..., username: _Optional[str] = ..., full_name: _Optional[str] = ..., is_active: _Optional[bool] = ..., is_system_admin: _Optional[bool] = ..., email_verified: _Optional[bool] = ...) -> None: ...
