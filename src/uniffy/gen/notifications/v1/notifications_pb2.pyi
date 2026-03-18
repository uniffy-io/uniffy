import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class NotificationType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    NOTIFICATION_TYPE_UNSPECIFIED: _ClassVar[NotificationType]
    NOTIFICATION_TYPE_CONTENT_SHARED: _ClassVar[NotificationType]
    NOTIFICATION_TYPE_CONTENT_MENTIONED: _ClassVar[NotificationType]
    NOTIFICATION_TYPE_CONTENT_EDITED: _ClassVar[NotificationType]
    NOTIFICATION_TYPE_CALENDAR_REMINDER: _ClassVar[NotificationType]
    NOTIFICATION_TYPE_CALENDAR_INVITE: _ClassVar[NotificationType]
    NOTIFICATION_TYPE_CALENDAR_RESPONSE: _ClassVar[NotificationType]
    NOTIFICATION_TYPE_PERMISSION_GRANTED: _ClassVar[NotificationType]
    NOTIFICATION_TYPE_PERMISSION_REVOKED: _ClassVar[NotificationType]
    NOTIFICATION_TYPE_SYSTEM_ANNOUNCEMENT: _ClassVar[NotificationType]
    NOTIFICATION_TYPE_TASK_ASSIGNED: _ClassVar[NotificationType]
    NOTIFICATION_TYPE_TASK_DUE_SOON: _ClassVar[NotificationType]
    NOTIFICATION_TYPE_TASK_OVERDUE: _ClassVar[NotificationType]
NOTIFICATION_TYPE_UNSPECIFIED: NotificationType
NOTIFICATION_TYPE_CONTENT_SHARED: NotificationType
NOTIFICATION_TYPE_CONTENT_MENTIONED: NotificationType
NOTIFICATION_TYPE_CONTENT_EDITED: NotificationType
NOTIFICATION_TYPE_CALENDAR_REMINDER: NotificationType
NOTIFICATION_TYPE_CALENDAR_INVITE: NotificationType
NOTIFICATION_TYPE_CALENDAR_RESPONSE: NotificationType
NOTIFICATION_TYPE_PERMISSION_GRANTED: NotificationType
NOTIFICATION_TYPE_PERMISSION_REVOKED: NotificationType
NOTIFICATION_TYPE_SYSTEM_ANNOUNCEMENT: NotificationType
NOTIFICATION_TYPE_TASK_ASSIGNED: NotificationType
NOTIFICATION_TYPE_TASK_DUE_SOON: NotificationType
NOTIFICATION_TYPE_TASK_OVERDUE: NotificationType

class Notification(_message.Message):
    __slots__ = ("id", "organization_id", "user_id", "notification_type", "title", "body", "source_urn", "actor_id", "is_read", "read_at", "created_at", "expires_at", "actor_name", "actor_avatar_url")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    NOTIFICATION_TYPE_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    BODY_FIELD_NUMBER: _ClassVar[int]
    SOURCE_URN_FIELD_NUMBER: _ClassVar[int]
    ACTOR_ID_FIELD_NUMBER: _ClassVar[int]
    IS_READ_FIELD_NUMBER: _ClassVar[int]
    READ_AT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    ACTOR_NAME_FIELD_NUMBER: _ClassVar[int]
    ACTOR_AVATAR_URL_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    user_id: str
    notification_type: NotificationType
    title: str
    body: str
    source_urn: str
    actor_id: str
    is_read: bool
    read_at: _timestamp_pb2.Timestamp
    created_at: _timestamp_pb2.Timestamp
    expires_at: _timestamp_pb2.Timestamp
    actor_name: str
    actor_avatar_url: str
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., user_id: _Optional[str] = ..., notification_type: _Optional[_Union[NotificationType, str]] = ..., title: _Optional[str] = ..., body: _Optional[str] = ..., source_urn: _Optional[str] = ..., actor_id: _Optional[str] = ..., is_read: _Optional[bool] = ..., read_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., actor_name: _Optional[str] = ..., actor_avatar_url: _Optional[str] = ...) -> None: ...

class ListNotificationsRequest(_message.Message):
    __slots__ = ("organization_id", "page", "page_size", "is_read", "notification_types")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    IS_READ_FIELD_NUMBER: _ClassVar[int]
    NOTIFICATION_TYPES_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    page: int
    page_size: int
    is_read: bool
    notification_types: _containers.RepeatedScalarFieldContainer[NotificationType]
    def __init__(self, organization_id: _Optional[str] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ..., is_read: _Optional[bool] = ..., notification_types: _Optional[_Iterable[_Union[NotificationType, str]]] = ...) -> None: ...

class ListNotificationsResponse(_message.Message):
    __slots__ = ("notifications", "total_count", "unread_count")
    NOTIFICATIONS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    UNREAD_COUNT_FIELD_NUMBER: _ClassVar[int]
    notifications: _containers.RepeatedCompositeFieldContainer[Notification]
    total_count: int
    unread_count: int
    def __init__(self, notifications: _Optional[_Iterable[_Union[Notification, _Mapping]]] = ..., total_count: _Optional[int] = ..., unread_count: _Optional[int] = ...) -> None: ...

class GetUnreadCountRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class GetUnreadCountResponse(_message.Message):
    __slots__ = ("unread_count",)
    UNREAD_COUNT_FIELD_NUMBER: _ClassVar[int]
    unread_count: int
    def __init__(self, unread_count: _Optional[int] = ...) -> None: ...

class MarkAsReadRequest(_message.Message):
    __slots__ = ("notification_id",)
    NOTIFICATION_ID_FIELD_NUMBER: _ClassVar[int]
    notification_id: str
    def __init__(self, notification_id: _Optional[str] = ...) -> None: ...

class MarkAsReadResponse(_message.Message):
    __slots__ = ("notification",)
    NOTIFICATION_FIELD_NUMBER: _ClassVar[int]
    notification: Notification
    def __init__(self, notification: _Optional[_Union[Notification, _Mapping]] = ...) -> None: ...

class MarkAllAsReadRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class MarkAllAsReadResponse(_message.Message):
    __slots__ = ("updated_count",)
    UPDATED_COUNT_FIELD_NUMBER: _ClassVar[int]
    updated_count: int
    def __init__(self, updated_count: _Optional[int] = ...) -> None: ...

class DeleteNotificationRequest(_message.Message):
    __slots__ = ("notification_id",)
    NOTIFICATION_ID_FIELD_NUMBER: _ClassVar[int]
    notification_id: str
    def __init__(self, notification_id: _Optional[str] = ...) -> None: ...

class DeleteNotificationResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class RegisterPushSubscriptionRequest(_message.Message):
    __slots__ = ("endpoint", "p256dh_key", "auth_key", "user_agent")
    ENDPOINT_FIELD_NUMBER: _ClassVar[int]
    P256DH_KEY_FIELD_NUMBER: _ClassVar[int]
    AUTH_KEY_FIELD_NUMBER: _ClassVar[int]
    USER_AGENT_FIELD_NUMBER: _ClassVar[int]
    endpoint: str
    p256dh_key: str
    auth_key: str
    user_agent: str
    def __init__(self, endpoint: _Optional[str] = ..., p256dh_key: _Optional[str] = ..., auth_key: _Optional[str] = ..., user_agent: _Optional[str] = ...) -> None: ...

class RegisterPushSubscriptionResponse(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class UnregisterPushSubscriptionRequest(_message.Message):
    __slots__ = ("endpoint",)
    ENDPOINT_FIELD_NUMBER: _ClassVar[int]
    endpoint: str
    def __init__(self, endpoint: _Optional[str] = ...) -> None: ...

class UnregisterPushSubscriptionResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class StreamNotificationsRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class FileUpdatePayload(_message.Message):
    __slots__ = ("file_id", "organization_id")
    FILE_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    file_id: str
    organization_id: str
    def __init__(self, file_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class StreamNotificationEvent(_message.Message):
    __slots__ = ("event_type", "notification", "timestamp", "file_update", "presence_changed", "mention_state_changed")
    class EventType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        EVENT_TYPE_UNSPECIFIED: _ClassVar[StreamNotificationEvent.EventType]
        EVENT_TYPE_NEW_NOTIFICATION: _ClassVar[StreamNotificationEvent.EventType]
        EVENT_TYPE_HEARTBEAT: _ClassVar[StreamNotificationEvent.EventType]
        EVENT_TYPE_FILE_UPDATED: _ClassVar[StreamNotificationEvent.EventType]
        EVENT_TYPE_PRESENCE_CHANGED: _ClassVar[StreamNotificationEvent.EventType]
        EVENT_TYPE_MENTION_STATE_CHANGED: _ClassVar[StreamNotificationEvent.EventType]
    EVENT_TYPE_UNSPECIFIED: StreamNotificationEvent.EventType
    EVENT_TYPE_NEW_NOTIFICATION: StreamNotificationEvent.EventType
    EVENT_TYPE_HEARTBEAT: StreamNotificationEvent.EventType
    EVENT_TYPE_FILE_UPDATED: StreamNotificationEvent.EventType
    EVENT_TYPE_PRESENCE_CHANGED: StreamNotificationEvent.EventType
    EVENT_TYPE_MENTION_STATE_CHANGED: StreamNotificationEvent.EventType
    EVENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    NOTIFICATION_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    FILE_UPDATE_FIELD_NUMBER: _ClassVar[int]
    PRESENCE_CHANGED_FIELD_NUMBER: _ClassVar[int]
    MENTION_STATE_CHANGED_FIELD_NUMBER: _ClassVar[int]
    event_type: StreamNotificationEvent.EventType
    notification: Notification
    timestamp: _timestamp_pb2.Timestamp
    file_update: FileUpdatePayload
    presence_changed: PresenceChangedPayload
    mention_state_changed: MentionStateChangedPayload
    def __init__(self, event_type: _Optional[_Union[StreamNotificationEvent.EventType, str]] = ..., notification: _Optional[_Union[Notification, _Mapping]] = ..., timestamp: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., file_update: _Optional[_Union[FileUpdatePayload, _Mapping]] = ..., presence_changed: _Optional[_Union[PresenceChangedPayload, _Mapping]] = ..., mention_state_changed: _Optional[_Union[MentionStateChangedPayload, _Mapping]] = ...) -> None: ...

class PresenceChangedPayload(_message.Message):
    __slots__ = ("user_id", "status", "last_active", "status_emoji", "status_text", "status_expires_at")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    LAST_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    STATUS_EMOJI_FIELD_NUMBER: _ClassVar[int]
    STATUS_TEXT_FIELD_NUMBER: _ClassVar[int]
    STATUS_EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    status: str
    last_active: _timestamp_pb2.Timestamp
    status_emoji: str
    status_text: str
    status_expires_at: _timestamp_pb2.Timestamp
    def __init__(self, user_id: _Optional[str] = ..., status: _Optional[str] = ..., last_active: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., status_emoji: _Optional[str] = ..., status_text: _Optional[str] = ..., status_expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class MentionStateChangedPayload(_message.Message):
    __slots__ = ("urn", "changes")
    class ChangesEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    URN_FIELD_NUMBER: _ClassVar[int]
    CHANGES_FIELD_NUMBER: _ClassVar[int]
    urn: str
    changes: _containers.ScalarMap[str, str]
    def __init__(self, urn: _Optional[str] = ..., changes: _Optional[_Mapping[str, str]] = ...) -> None: ...

class GetVapidPublicKeyRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetVapidPublicKeyResponse(_message.Message):
    __slots__ = ("public_key",)
    PUBLIC_KEY_FIELD_NUMBER: _ClassVar[int]
    public_key: str
    def __init__(self, public_key: _Optional[str] = ...) -> None: ...
