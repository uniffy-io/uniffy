import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class UserProfile(_message.Message):
    __slots__ = ("id", "email", "full_name", "username", "avatar_url", "accent_color", "font_family", "is_active", "is_system_admin", "created_at", "updated_at", "has_avatar", "pronouns")
    ID_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    FULL_NAME_FIELD_NUMBER: _ClassVar[int]
    USERNAME_FIELD_NUMBER: _ClassVar[int]
    AVATAR_URL_FIELD_NUMBER: _ClassVar[int]
    ACCENT_COLOR_FIELD_NUMBER: _ClassVar[int]
    FONT_FAMILY_FIELD_NUMBER: _ClassVar[int]
    IS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    IS_SYSTEM_ADMIN_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    HAS_AVATAR_FIELD_NUMBER: _ClassVar[int]
    PRONOUNS_FIELD_NUMBER: _ClassVar[int]
    id: str
    email: str
    full_name: str
    username: str
    avatar_url: str
    accent_color: str
    font_family: str
    is_active: bool
    is_system_admin: bool
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    has_avatar: bool
    pronouns: str
    def __init__(self, id: _Optional[str] = ..., email: _Optional[str] = ..., full_name: _Optional[str] = ..., username: _Optional[str] = ..., avatar_url: _Optional[str] = ..., accent_color: _Optional[str] = ..., font_family: _Optional[str] = ..., is_active: _Optional[bool] = ..., is_system_admin: _Optional[bool] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., has_avatar: _Optional[bool] = ..., pronouns: _Optional[str] = ...) -> None: ...

class GetMyProfileRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetMyProfileResponse(_message.Message):
    __slots__ = ("user",)
    USER_FIELD_NUMBER: _ClassVar[int]
    user: UserProfile
    def __init__(self, user: _Optional[_Union[UserProfile, _Mapping]] = ...) -> None: ...

class UpdateMyProfileResponse(_message.Message):
    __slots__ = ("user",)
    USER_FIELD_NUMBER: _ClassVar[int]
    user: UserProfile
    def __init__(self, user: _Optional[_Union[UserProfile, _Mapping]] = ...) -> None: ...

class UploadAvatarResponse(_message.Message):
    __slots__ = ("user",)
    USER_FIELD_NUMBER: _ClassVar[int]
    user: UserProfile
    def __init__(self, user: _Optional[_Union[UserProfile, _Mapping]] = ...) -> None: ...

class DeleteAvatarResponse(_message.Message):
    __slots__ = ("user",)
    USER_FIELD_NUMBER: _ClassVar[int]
    user: UserProfile
    def __init__(self, user: _Optional[_Union[UserProfile, _Mapping]] = ...) -> None: ...

class UpdateMyProfileRequest(_message.Message):
    __slots__ = ("accent_color", "font_family", "pronouns")
    ACCENT_COLOR_FIELD_NUMBER: _ClassVar[int]
    FONT_FAMILY_FIELD_NUMBER: _ClassVar[int]
    PRONOUNS_FIELD_NUMBER: _ClassVar[int]
    accent_color: str
    font_family: str
    pronouns: str
    def __init__(self, accent_color: _Optional[str] = ..., font_family: _Optional[str] = ..., pronouns: _Optional[str] = ...) -> None: ...

class UploadAvatarRequest(_message.Message):
    __slots__ = ("image_data", "filename")
    IMAGE_DATA_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    image_data: bytes
    filename: str
    def __init__(self, image_data: _Optional[bytes] = ..., filename: _Optional[str] = ...) -> None: ...

class DeleteAvatarRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...
