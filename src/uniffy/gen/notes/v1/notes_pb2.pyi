import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class VisibilityScope(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    VISIBILITY_SCOPE_UNSPECIFIED: _ClassVar[VisibilityScope]
    VISIBILITY_SCOPE_PRIVATE: _ClassVar[VisibilityScope]
    VISIBILITY_SCOPE_GROUP: _ClassVar[VisibilityScope]
    VISIBILITY_SCOPE_ORGANIZATION: _ClassVar[VisibilityScope]
    VISIBILITY_SCOPE_PUBLIC: _ClassVar[VisibilityScope]

class PermissionLevel(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    PERMISSION_LEVEL_UNSPECIFIED: _ClassVar[PermissionLevel]
    PERMISSION_LEVEL_VIEW: _ClassVar[PermissionLevel]
    PERMISSION_LEVEL_EDIT: _ClassVar[PermissionLevel]
    PERMISSION_LEVEL_ADMIN: _ClassVar[PermissionLevel]
    PERMISSION_LEVEL_OWNER: _ClassVar[PermissionLevel]

class NodeType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    NODE_TYPE_UNSPECIFIED: _ClassVar[NodeType]
    NODE_TYPE_NOTE: _ClassVar[NodeType]
    NODE_TYPE_FOLDER: _ClassVar[NodeType]
    NODE_TYPE_TEMPLATE: _ClassVar[NodeType]
VISIBILITY_SCOPE_UNSPECIFIED: VisibilityScope
VISIBILITY_SCOPE_PRIVATE: VisibilityScope
VISIBILITY_SCOPE_GROUP: VisibilityScope
VISIBILITY_SCOPE_ORGANIZATION: VisibilityScope
VISIBILITY_SCOPE_PUBLIC: VisibilityScope
PERMISSION_LEVEL_UNSPECIFIED: PermissionLevel
PERMISSION_LEVEL_VIEW: PermissionLevel
PERMISSION_LEVEL_EDIT: PermissionLevel
PERMISSION_LEVEL_ADMIN: PermissionLevel
PERMISSION_LEVEL_OWNER: PermissionLevel
NODE_TYPE_UNSPECIFIED: NodeType
NODE_TYPE_NOTE: NodeType
NODE_TYPE_FOLDER: NodeType
NODE_TYPE_TEMPLATE: NodeType

class CreateNoteRequest(_message.Message):
    __slots__ = ("organization_id", "title", "content", "slug", "parent_id", "tags", "metadata", "visibility", "group_ids", "node_type", "icon")
    class MetadataEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    PARENT_ID_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    VISIBILITY_FIELD_NUMBER: _ClassVar[int]
    GROUP_IDS_FIELD_NUMBER: _ClassVar[int]
    NODE_TYPE_FIELD_NUMBER: _ClassVar[int]
    ICON_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    title: str
    content: str
    slug: str
    parent_id: str
    tags: _containers.RepeatedScalarFieldContainer[str]
    metadata: _containers.ScalarMap[str, str]
    visibility: VisibilityScope
    group_ids: _containers.RepeatedScalarFieldContainer[str]
    node_type: NodeType
    icon: NoteIcon
    def __init__(self, organization_id: _Optional[str] = ..., title: _Optional[str] = ..., content: _Optional[str] = ..., slug: _Optional[str] = ..., parent_id: _Optional[str] = ..., tags: _Optional[_Iterable[str]] = ..., metadata: _Optional[_Mapping[str, str]] = ..., visibility: _Optional[_Union[VisibilityScope, str]] = ..., group_ids: _Optional[_Iterable[str]] = ..., node_type: _Optional[_Union[NodeType, str]] = ..., icon: _Optional[_Union[NoteIcon, _Mapping]] = ...) -> None: ...

class GetNoteRequest(_message.Message):
    __slots__ = ("note_id", "organization_id")
    NOTE_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    note_id: str
    organization_id: str
    def __init__(self, note_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class UpdateNoteRequest(_message.Message):
    __slots__ = ("note_id", "organization_id", "title", "content", "slug", "parent_id", "tags", "metadata", "icon")
    class MetadataEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    NOTE_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    PARENT_ID_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    ICON_FIELD_NUMBER: _ClassVar[int]
    note_id: str
    organization_id: str
    title: str
    content: str
    slug: str
    parent_id: str
    tags: _containers.RepeatedScalarFieldContainer[str]
    metadata: _containers.ScalarMap[str, str]
    icon: NoteIcon
    def __init__(self, note_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., title: _Optional[str] = ..., content: _Optional[str] = ..., slug: _Optional[str] = ..., parent_id: _Optional[str] = ..., tags: _Optional[_Iterable[str]] = ..., metadata: _Optional[_Mapping[str, str]] = ..., icon: _Optional[_Union[NoteIcon, _Mapping]] = ...) -> None: ...

class DeleteNoteRequest(_message.Message):
    __slots__ = ("note_id", "organization_id", "permanent")
    NOTE_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PERMANENT_FIELD_NUMBER: _ClassVar[int]
    note_id: str
    organization_id: str
    permanent: bool
    def __init__(self, note_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., permanent: _Optional[bool] = ...) -> None: ...

class DeleteNoteResponse(_message.Message):
    __slots__ = ("success", "message")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    success: bool
    message: str
    def __init__(self, success: _Optional[bool] = ..., message: _Optional[str] = ...) -> None: ...

class NoteResponse(_message.Message):
    __slots__ = ("note",)
    NOTE_FIELD_NUMBER: _ClassVar[int]
    note: Note
    def __init__(self, note: _Optional[_Union[Note, _Mapping]] = ...) -> None: ...

class ListNotesRequest(_message.Message):
    __slots__ = ("organization_id", "parent_id", "tags", "include_deleted", "page", "page_size", "sort_by", "sort_order", "visibility", "group_id", "personal_only", "exclude_content")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PARENT_ID_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_DELETED_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    SORT_BY_FIELD_NUMBER: _ClassVar[int]
    SORT_ORDER_FIELD_NUMBER: _ClassVar[int]
    VISIBILITY_FIELD_NUMBER: _ClassVar[int]
    GROUP_ID_FIELD_NUMBER: _ClassVar[int]
    PERSONAL_ONLY_FIELD_NUMBER: _ClassVar[int]
    EXCLUDE_CONTENT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    parent_id: str
    tags: _containers.RepeatedScalarFieldContainer[str]
    include_deleted: bool
    page: int
    page_size: int
    sort_by: str
    sort_order: str
    visibility: VisibilityScope
    group_id: str
    personal_only: bool
    exclude_content: bool
    def __init__(self, organization_id: _Optional[str] = ..., parent_id: _Optional[str] = ..., tags: _Optional[_Iterable[str]] = ..., include_deleted: _Optional[bool] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ..., sort_by: _Optional[str] = ..., sort_order: _Optional[str] = ..., visibility: _Optional[_Union[VisibilityScope, str]] = ..., group_id: _Optional[str] = ..., personal_only: _Optional[bool] = ..., exclude_content: _Optional[bool] = ...) -> None: ...

class ListNotesResponse(_message.Message):
    __slots__ = ("notes", "total_count", "page", "page_size", "total_pages")
    NOTES_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    TOTAL_PAGES_FIELD_NUMBER: _ClassVar[int]
    notes: _containers.RepeatedCompositeFieldContainer[Note]
    total_count: int
    page: int
    page_size: int
    total_pages: int
    def __init__(self, notes: _Optional[_Iterable[_Union[Note, _Mapping]]] = ..., total_count: _Optional[int] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ..., total_pages: _Optional[int] = ...) -> None: ...

class SearchNotesRequest(_message.Message):
    __slots__ = ("organization_id", "query", "tags", "include_deleted", "page", "page_size")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    QUERY_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_DELETED_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    query: str
    tags: _containers.RepeatedScalarFieldContainer[str]
    include_deleted: bool
    page: int
    page_size: int
    def __init__(self, organization_id: _Optional[str] = ..., query: _Optional[str] = ..., tags: _Optional[_Iterable[str]] = ..., include_deleted: _Optional[bool] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ...) -> None: ...

class SearchNotesResponse(_message.Message):
    __slots__ = ("notes", "total_count", "page", "page_size")
    NOTES_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    notes: _containers.RepeatedCompositeFieldContainer[Note]
    total_count: int
    page: int
    page_size: int
    def __init__(self, notes: _Optional[_Iterable[_Union[Note, _Mapping]]] = ..., total_count: _Optional[int] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ...) -> None: ...

class GetBacklinksRequest(_message.Message):
    __slots__ = ("note_id", "organization_id")
    NOTE_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    note_id: str
    organization_id: str
    def __init__(self, note_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class BacklinksResponse(_message.Message):
    __slots__ = ("backlinks", "total_count")
    BACKLINKS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    backlinks: _containers.RepeatedCompositeFieldContainer[NoteReference]
    total_count: int
    def __init__(self, backlinks: _Optional[_Iterable[_Union[NoteReference, _Mapping]]] = ..., total_count: _Optional[int] = ...) -> None: ...

class RestoreNoteRequest(_message.Message):
    __slots__ = ("note_id", "organization_id")
    NOTE_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    note_id: str
    organization_id: str
    def __init__(self, note_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class EmptyTrashRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class EmptyTrashResponse(_message.Message):
    __slots__ = ("deleted_count", "success", "message")
    DELETED_COUNT_FIELD_NUMBER: _ClassVar[int]
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    deleted_count: int
    success: bool
    message: str
    def __init__(self, deleted_count: _Optional[int] = ..., success: _Optional[bool] = ..., message: _Optional[str] = ...) -> None: ...

class AutosaveNoteRequest(_message.Message):
    __slots__ = ("note_id", "organization_id", "content", "title", "client_timestamp")
    NOTE_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    CLIENT_TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    note_id: str
    organization_id: str
    content: str
    title: str
    client_timestamp: int
    def __init__(self, note_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., content: _Optional[str] = ..., title: _Optional[str] = ..., client_timestamp: _Optional[int] = ...) -> None: ...

class AutosaveNoteResponse(_message.Message):
    __slots__ = ("success", "saved_at", "version")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    SAVED_AT_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    success: bool
    saved_at: _timestamp_pb2.Timestamp
    version: int
    def __init__(self, success: _Optional[bool] = ..., saved_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., version: _Optional[int] = ...) -> None: ...

class NoteIcon(_message.Message):
    __slots__ = ("icon_type", "value")
    ICON_TYPE_FIELD_NUMBER: _ClassVar[int]
    VALUE_FIELD_NUMBER: _ClassVar[int]
    icon_type: str
    value: str
    def __init__(self, icon_type: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...

class Note(_message.Message):
    __slots__ = ("id", "organization_id", "owner_id", "visibility", "node_type", "title", "content", "slug", "is_deleted", "version", "parent_id", "tags", "metadata", "created_at", "updated_at", "deleted_at", "group_ids", "user_permission", "outgoing_references", "icon")
    class MetadataEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    VISIBILITY_FIELD_NUMBER: _ClassVar[int]
    NODE_TYPE_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    IS_DELETED_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    PARENT_ID_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    DELETED_AT_FIELD_NUMBER: _ClassVar[int]
    GROUP_IDS_FIELD_NUMBER: _ClassVar[int]
    USER_PERMISSION_FIELD_NUMBER: _ClassVar[int]
    OUTGOING_REFERENCES_FIELD_NUMBER: _ClassVar[int]
    ICON_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    owner_id: str
    visibility: VisibilityScope
    node_type: NodeType
    title: str
    content: str
    slug: str
    is_deleted: bool
    version: int
    parent_id: str
    tags: _containers.RepeatedScalarFieldContainer[str]
    metadata: _containers.ScalarMap[str, str]
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    deleted_at: _timestamp_pb2.Timestamp
    group_ids: _containers.RepeatedScalarFieldContainer[str]
    user_permission: PermissionLevel
    outgoing_references: _containers.RepeatedScalarFieldContainer[str]
    icon: NoteIcon
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., owner_id: _Optional[str] = ..., visibility: _Optional[_Union[VisibilityScope, str]] = ..., node_type: _Optional[_Union[NodeType, str]] = ..., title: _Optional[str] = ..., content: _Optional[str] = ..., slug: _Optional[str] = ..., is_deleted: _Optional[bool] = ..., version: _Optional[int] = ..., parent_id: _Optional[str] = ..., tags: _Optional[_Iterable[str]] = ..., metadata: _Optional[_Mapping[str, str]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., deleted_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., group_ids: _Optional[_Iterable[str]] = ..., user_permission: _Optional[_Union[PermissionLevel, str]] = ..., outgoing_references: _Optional[_Iterable[str]] = ..., icon: _Optional[_Union[NoteIcon, _Mapping]] = ...) -> None: ...

class NoteReference(_message.Message):
    __slots__ = ("id", "title", "slug", "owner_id", "updated_at", "visibility", "node_type")
    ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    VISIBILITY_FIELD_NUMBER: _ClassVar[int]
    NODE_TYPE_FIELD_NUMBER: _ClassVar[int]
    id: str
    title: str
    slug: str
    owner_id: str
    updated_at: _timestamp_pb2.Timestamp
    visibility: VisibilityScope
    node_type: NodeType
    def __init__(self, id: _Optional[str] = ..., title: _Optional[str] = ..., slug: _Optional[str] = ..., owner_id: _Optional[str] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., visibility: _Optional[_Union[VisibilityScope, str]] = ..., node_type: _Optional[_Union[NodeType, str]] = ...) -> None: ...

class MoveNoteRequest(_message.Message):
    __slots__ = ("note_id", "organization_id", "target_visibility", "target_group_ids")
    NOTE_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TARGET_VISIBILITY_FIELD_NUMBER: _ClassVar[int]
    TARGET_GROUP_IDS_FIELD_NUMBER: _ClassVar[int]
    note_id: str
    organization_id: str
    target_visibility: VisibilityScope
    target_group_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, note_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., target_visibility: _Optional[_Union[VisibilityScope, str]] = ..., target_group_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class CopyNoteRequest(_message.Message):
    __slots__ = ("note_id", "organization_id", "target_visibility", "target_group_ids", "title")
    NOTE_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TARGET_VISIBILITY_FIELD_NUMBER: _ClassVar[int]
    TARGET_GROUP_IDS_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    note_id: str
    organization_id: str
    target_visibility: VisibilityScope
    target_group_ids: _containers.RepeatedScalarFieldContainer[str]
    title: str
    def __init__(self, note_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., target_visibility: _Optional[_Union[VisibilityScope, str]] = ..., target_group_ids: _Optional[_Iterable[str]] = ..., title: _Optional[str] = ...) -> None: ...

class ShareNoteWithGroupRequest(_message.Message):
    __slots__ = ("note_id", "organization_id", "group_id")
    NOTE_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    GROUP_ID_FIELD_NUMBER: _ClassVar[int]
    note_id: str
    organization_id: str
    group_id: str
    def __init__(self, note_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., group_id: _Optional[str] = ...) -> None: ...

class UnshareNoteFromGroupRequest(_message.Message):
    __slots__ = ("note_id", "organization_id", "group_id")
    NOTE_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    GROUP_ID_FIELD_NUMBER: _ClassVar[int]
    note_id: str
    organization_id: str
    group_id: str
    def __init__(self, note_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., group_id: _Optional[str] = ...) -> None: ...

class ShareNoteResponse(_message.Message):
    __slots__ = ("success", "message", "group_ids")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    GROUP_IDS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    message: str
    group_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, success: _Optional[bool] = ..., message: _Optional[str] = ..., group_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class GetNoteSharingRequest(_message.Message):
    __slots__ = ("note_id", "organization_id")
    NOTE_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    note_id: str
    organization_id: str
    def __init__(self, note_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class NoteSharingResponse(_message.Message):
    __slots__ = ("visibility", "owner_id", "group_ids", "permissions")
    VISIBILITY_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    GROUP_IDS_FIELD_NUMBER: _ClassVar[int]
    PERMISSIONS_FIELD_NUMBER: _ClassVar[int]
    visibility: VisibilityScope
    owner_id: str
    group_ids: _containers.RepeatedScalarFieldContainer[str]
    permissions: _containers.RepeatedCompositeFieldContainer[ContentPermission]
    def __init__(self, visibility: _Optional[_Union[VisibilityScope, str]] = ..., owner_id: _Optional[str] = ..., group_ids: _Optional[_Iterable[str]] = ..., permissions: _Optional[_Iterable[_Union[ContentPermission, _Mapping]]] = ...) -> None: ...

class GrantPermissionRequest(_message.Message):
    __slots__ = ("note_id", "organization_id", "subject_type", "subject_id", "permission_level", "can_view", "can_edit", "can_delete", "can_share", "can_move")
    NOTE_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_TYPE_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_ID_FIELD_NUMBER: _ClassVar[int]
    PERMISSION_LEVEL_FIELD_NUMBER: _ClassVar[int]
    CAN_VIEW_FIELD_NUMBER: _ClassVar[int]
    CAN_EDIT_FIELD_NUMBER: _ClassVar[int]
    CAN_DELETE_FIELD_NUMBER: _ClassVar[int]
    CAN_SHARE_FIELD_NUMBER: _ClassVar[int]
    CAN_MOVE_FIELD_NUMBER: _ClassVar[int]
    note_id: str
    organization_id: str
    subject_type: str
    subject_id: str
    permission_level: PermissionLevel
    can_view: bool
    can_edit: bool
    can_delete: bool
    can_share: bool
    can_move: bool
    def __init__(self, note_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., subject_type: _Optional[str] = ..., subject_id: _Optional[str] = ..., permission_level: _Optional[_Union[PermissionLevel, str]] = ..., can_view: _Optional[bool] = ..., can_edit: _Optional[bool] = ..., can_delete: _Optional[bool] = ..., can_share: _Optional[bool] = ..., can_move: _Optional[bool] = ...) -> None: ...

class RevokePermissionRequest(_message.Message):
    __slots__ = ("note_id", "organization_id", "subject_type", "subject_id")
    NOTE_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_TYPE_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_ID_FIELD_NUMBER: _ClassVar[int]
    note_id: str
    organization_id: str
    subject_type: str
    subject_id: str
    def __init__(self, note_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., subject_type: _Optional[str] = ..., subject_id: _Optional[str] = ...) -> None: ...

class PermissionResponse(_message.Message):
    __slots__ = ("success", "message")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    success: bool
    message: str
    def __init__(self, success: _Optional[bool] = ..., message: _Optional[str] = ...) -> None: ...

class ContentPermission(_message.Message):
    __slots__ = ("id", "subject_type", "subject_id", "permission_level", "can_view", "can_edit", "can_delete", "can_share", "can_move", "granted_by_user_id", "granted_at", "expires_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_TYPE_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_ID_FIELD_NUMBER: _ClassVar[int]
    PERMISSION_LEVEL_FIELD_NUMBER: _ClassVar[int]
    CAN_VIEW_FIELD_NUMBER: _ClassVar[int]
    CAN_EDIT_FIELD_NUMBER: _ClassVar[int]
    CAN_DELETE_FIELD_NUMBER: _ClassVar[int]
    CAN_SHARE_FIELD_NUMBER: _ClassVar[int]
    CAN_MOVE_FIELD_NUMBER: _ClassVar[int]
    GRANTED_BY_USER_ID_FIELD_NUMBER: _ClassVar[int]
    GRANTED_AT_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    subject_type: str
    subject_id: str
    permission_level: PermissionLevel
    can_view: bool
    can_edit: bool
    can_delete: bool
    can_share: bool
    can_move: bool
    granted_by_user_id: str
    granted_at: _timestamp_pb2.Timestamp
    expires_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., subject_type: _Optional[str] = ..., subject_id: _Optional[str] = ..., permission_level: _Optional[_Union[PermissionLevel, str]] = ..., can_view: _Optional[bool] = ..., can_edit: _Optional[bool] = ..., can_delete: _Optional[bool] = ..., can_share: _Optional[bool] = ..., can_move: _Optional[bool] = ..., granted_by_user_id: _Optional[str] = ..., granted_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...
