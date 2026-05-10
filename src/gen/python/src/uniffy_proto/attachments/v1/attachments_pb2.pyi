import datetime

from common.v1 import common_pb2 as _common_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Attachment(_message.Message):
    __slots__ = ("id", "organization_id", "file_id", "content_type", "content_id", "attached_by_user_id", "attached_at", "filename", "mime_type", "size_bytes", "owner_info")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    FILE_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_ID_FIELD_NUMBER: _ClassVar[int]
    ATTACHED_BY_USER_ID_FIELD_NUMBER: _ClassVar[int]
    ATTACHED_AT_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    MIME_TYPE_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    OWNER_INFO_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    file_id: str
    content_type: _common_pb2.ContentType
    content_id: str
    attached_by_user_id: str
    attached_at: _timestamp_pb2.Timestamp
    filename: str
    mime_type: str
    size_bytes: int
    owner_info: AttachedFileOwner
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., file_id: _Optional[str] = ..., content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., content_id: _Optional[str] = ..., attached_by_user_id: _Optional[str] = ..., attached_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., filename: _Optional[str] = ..., mime_type: _Optional[str] = ..., size_bytes: _Optional[int] = ..., owner_info: _Optional[_Union[AttachedFileOwner, _Mapping]] = ...) -> None: ...

class AttachedFileOwner(_message.Message):
    __slots__ = ("id", "name", "email")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    email: str
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., email: _Optional[str] = ...) -> None: ...

class AttachFileRequest(_message.Message):
    __slots__ = ("organization_id", "source_file_id", "content_type", "content_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FILE_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    source_file_id: str
    content_type: _common_pb2.ContentType
    content_id: str
    def __init__(self, organization_id: _Optional[str] = ..., source_file_id: _Optional[str] = ..., content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., content_id: _Optional[str] = ...) -> None: ...

class AttachFileResponse(_message.Message):
    __slots__ = ("attachment",)
    ATTACHMENT_FIELD_NUMBER: _ClassVar[int]
    attachment: Attachment
    def __init__(self, attachment: _Optional[_Union[Attachment, _Mapping]] = ...) -> None: ...

class DetachFileRequest(_message.Message):
    __slots__ = ("organization_id", "attachment_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ATTACHMENT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    attachment_id: str
    def __init__(self, organization_id: _Optional[str] = ..., attachment_id: _Optional[str] = ...) -> None: ...

class DetachFileResponse(_message.Message):
    __slots__ = ("success", "message")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    success: bool
    message: str
    def __init__(self, success: _Optional[bool] = ..., message: _Optional[str] = ...) -> None: ...

class ListAttachmentsRequest(_message.Message):
    __slots__ = ("organization_id", "content_type", "content_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    content_type: _common_pb2.ContentType
    content_id: str
    def __init__(self, organization_id: _Optional[str] = ..., content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., content_id: _Optional[str] = ...) -> None: ...

class ListAttachmentsResponse(_message.Message):
    __slots__ = ("attachments", "total_count")
    ATTACHMENTS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    attachments: _containers.RepeatedCompositeFieldContainer[Attachment]
    total_count: int
    def __init__(self, attachments: _Optional[_Iterable[_Union[Attachment, _Mapping]]] = ..., total_count: _Optional[int] = ...) -> None: ...

class BatchListAttachmentsRequest(_message.Message):
    __slots__ = ("organization_id", "content_type", "content_ids")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_IDS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    content_type: _common_pb2.ContentType
    content_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, organization_id: _Optional[str] = ..., content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., content_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class BatchListAttachmentsGroup(_message.Message):
    __slots__ = ("content_id", "attachments")
    CONTENT_ID_FIELD_NUMBER: _ClassVar[int]
    ATTACHMENTS_FIELD_NUMBER: _ClassVar[int]
    content_id: str
    attachments: _containers.RepeatedCompositeFieldContainer[Attachment]
    def __init__(self, content_id: _Optional[str] = ..., attachments: _Optional[_Iterable[_Union[Attachment, _Mapping]]] = ...) -> None: ...

class BatchListAttachmentsResponse(_message.Message):
    __slots__ = ("groups",)
    GROUPS_FIELD_NUMBER: _ClassVar[int]
    groups: _containers.RepeatedCompositeFieldContainer[BatchListAttachmentsGroup]
    def __init__(self, groups: _Optional[_Iterable[_Union[BatchListAttachmentsGroup, _Mapping]]] = ...) -> None: ...

class ListSharedAttachmentsRequest(_message.Message):
    __slots__ = ("organization_id", "content_type_filter", "page", "page_size")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FILTER_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    content_type_filter: _common_pb2.ContentType
    page: int
    page_size: int
    def __init__(self, organization_id: _Optional[str] = ..., content_type_filter: _Optional[_Union[_common_pb2.ContentType, str]] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ...) -> None: ...

class ListSharedAttachmentsResponse(_message.Message):
    __slots__ = ("groups", "total_count", "page", "page_size", "total_pages")
    GROUPS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    TOTAL_PAGES_FIELD_NUMBER: _ClassVar[int]
    groups: _containers.RepeatedCompositeFieldContainer[SharedAttachmentGroup]
    total_count: int
    page: int
    page_size: int
    total_pages: int
    def __init__(self, groups: _Optional[_Iterable[_Union[SharedAttachmentGroup, _Mapping]]] = ..., total_count: _Optional[int] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ..., total_pages: _Optional[int] = ...) -> None: ...

class SharedAttachmentGroup(_message.Message):
    __slots__ = ("content_type", "attachments")
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    ATTACHMENTS_FIELD_NUMBER: _ClassVar[int]
    content_type: _common_pb2.ContentType
    attachments: _containers.RepeatedCompositeFieldContainer[SharedAttachment]
    def __init__(self, content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., attachments: _Optional[_Iterable[_Union[SharedAttachment, _Mapping]]] = ...) -> None: ...

class SharedAttachment(_message.Message):
    __slots__ = ("attachment", "content_title", "content_owner_name")
    ATTACHMENT_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TITLE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_OWNER_NAME_FIELD_NUMBER: _ClassVar[int]
    attachment: Attachment
    content_title: str
    content_owner_name: str
    def __init__(self, attachment: _Optional[_Union[Attachment, _Mapping]] = ..., content_title: _Optional[str] = ..., content_owner_name: _Optional[str] = ...) -> None: ...

class GetAttachmentsFolderRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class GetAttachmentsFolderResponse(_message.Message):
    __slots__ = ("folder_id",)
    FOLDER_ID_FIELD_NUMBER: _ClassVar[int]
    folder_id: str
    def __init__(self, folder_id: _Optional[str] = ...) -> None: ...
