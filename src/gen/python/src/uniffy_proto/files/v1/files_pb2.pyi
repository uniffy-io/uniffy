import datetime

from common.v1 import common_pb2 as _common_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from tags.v1 import tags_pb2 as _tags_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class UploadStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    UPLOAD_STATUS_UNSPECIFIED: _ClassVar[UploadStatus]
    UPLOAD_STATUS_ACTIVE: _ClassVar[UploadStatus]
    UPLOAD_STATUS_COMPLETED: _ClassVar[UploadStatus]
    UPLOAD_STATUS_ABORTED: _ClassVar[UploadStatus]
    UPLOAD_STATUS_EXPIRED: _ClassVar[UploadStatus]

class ExtractionStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    EXTRACTION_STATUS_UNSPECIFIED: _ClassVar[ExtractionStatus]
    EXTRACTION_STATUS_PENDING: _ClassVar[ExtractionStatus]
    EXTRACTION_STATUS_PROCESSING: _ClassVar[ExtractionStatus]
    EXTRACTION_STATUS_COMPLETED: _ClassVar[ExtractionStatus]
    EXTRACTION_STATUS_FAILED: _ClassVar[ExtractionStatus]
    EXTRACTION_STATUS_SKIPPED: _ClassVar[ExtractionStatus]

class TranscodeStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    TRANSCODE_STATUS_UNSPECIFIED: _ClassVar[TranscodeStatus]
    TRANSCODE_STATUS_NOT_NEEDED: _ClassVar[TranscodeStatus]
    TRANSCODE_STATUS_PENDING: _ClassVar[TranscodeStatus]
    TRANSCODE_STATUS_PROCESSING: _ClassVar[TranscodeStatus]
    TRANSCODE_STATUS_COMPLETED: _ClassVar[TranscodeStatus]
    TRANSCODE_STATUS_FAILED: _ClassVar[TranscodeStatus]
UPLOAD_STATUS_UNSPECIFIED: UploadStatus
UPLOAD_STATUS_ACTIVE: UploadStatus
UPLOAD_STATUS_COMPLETED: UploadStatus
UPLOAD_STATUS_ABORTED: UploadStatus
UPLOAD_STATUS_EXPIRED: UploadStatus
EXTRACTION_STATUS_UNSPECIFIED: ExtractionStatus
EXTRACTION_STATUS_PENDING: ExtractionStatus
EXTRACTION_STATUS_PROCESSING: ExtractionStatus
EXTRACTION_STATUS_COMPLETED: ExtractionStatus
EXTRACTION_STATUS_FAILED: ExtractionStatus
EXTRACTION_STATUS_SKIPPED: ExtractionStatus
TRANSCODE_STATUS_UNSPECIFIED: TranscodeStatus
TRANSCODE_STATUS_NOT_NEEDED: TranscodeStatus
TRANSCODE_STATUS_PENDING: TranscodeStatus
TRANSCODE_STATUS_PROCESSING: TranscodeStatus
TRANSCODE_STATUS_COMPLETED: TranscodeStatus
TRANSCODE_STATUS_FAILED: TranscodeStatus

class InitiateUploadRequest(_message.Message):
    __slots__ = ("organization_id", "filename", "mime_type", "total_size", "folder_id", "access_mode", "baseline_role")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    MIME_TYPE_FIELD_NUMBER: _ClassVar[int]
    TOTAL_SIZE_FIELD_NUMBER: _ClassVar[int]
    FOLDER_ID_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    filename: str
    mime_type: str
    total_size: int
    folder_id: str
    access_mode: _common_pb2.AccessMode
    baseline_role: _common_pb2.ContentRole
    def __init__(self, organization_id: _Optional[str] = ..., filename: _Optional[str] = ..., mime_type: _Optional[str] = ..., total_size: _Optional[int] = ..., folder_id: _Optional[str] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ...) -> None: ...

class InitiateUploadResponse(_message.Message):
    __slots__ = ("upload_id", "chunk_size", "total_chunks")
    UPLOAD_ID_FIELD_NUMBER: _ClassVar[int]
    CHUNK_SIZE_FIELD_NUMBER: _ClassVar[int]
    TOTAL_CHUNKS_FIELD_NUMBER: _ClassVar[int]
    upload_id: str
    chunk_size: int
    total_chunks: int
    def __init__(self, upload_id: _Optional[str] = ..., chunk_size: _Optional[int] = ..., total_chunks: _Optional[int] = ...) -> None: ...

class UploadChunkRequest(_message.Message):
    __slots__ = ("upload_id", "chunk_number", "data", "is_last")
    UPLOAD_ID_FIELD_NUMBER: _ClassVar[int]
    CHUNK_NUMBER_FIELD_NUMBER: _ClassVar[int]
    DATA_FIELD_NUMBER: _ClassVar[int]
    IS_LAST_FIELD_NUMBER: _ClassVar[int]
    upload_id: str
    chunk_number: int
    data: bytes
    is_last: bool
    def __init__(self, upload_id: _Optional[str] = ..., chunk_number: _Optional[int] = ..., data: _Optional[bytes] = ..., is_last: _Optional[bool] = ...) -> None: ...

class UploadChunksRequest(_message.Message):
    __slots__ = ("upload_id", "chunk_number", "data", "is_last")
    UPLOAD_ID_FIELD_NUMBER: _ClassVar[int]
    CHUNK_NUMBER_FIELD_NUMBER: _ClassVar[int]
    DATA_FIELD_NUMBER: _ClassVar[int]
    IS_LAST_FIELD_NUMBER: _ClassVar[int]
    upload_id: str
    chunk_number: int
    data: bytes
    is_last: bool
    def __init__(self, upload_id: _Optional[str] = ..., chunk_number: _Optional[int] = ..., data: _Optional[bytes] = ..., is_last: _Optional[bool] = ...) -> None: ...

class UploadChunkResponse(_message.Message):
    __slots__ = ("success", "chunk_number", "chunks_received")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    CHUNK_NUMBER_FIELD_NUMBER: _ClassVar[int]
    CHUNKS_RECEIVED_FIELD_NUMBER: _ClassVar[int]
    success: bool
    chunk_number: int
    chunks_received: int
    def __init__(self, success: _Optional[bool] = ..., chunk_number: _Optional[int] = ..., chunks_received: _Optional[int] = ...) -> None: ...

class CompleteUploadRequest(_message.Message):
    __slots__ = ("upload_id", "tag_ids")
    UPLOAD_ID_FIELD_NUMBER: _ClassVar[int]
    TAG_IDS_FIELD_NUMBER: _ClassVar[int]
    upload_id: str
    tag_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, upload_id: _Optional[str] = ..., tag_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class UploadChunksResponse(_message.Message):
    __slots__ = ("file",)
    FILE_FIELD_NUMBER: _ClassVar[int]
    file: File
    def __init__(self, file: _Optional[_Union[File, _Mapping]] = ...) -> None: ...

class CompleteUploadResponse(_message.Message):
    __slots__ = ("file",)
    FILE_FIELD_NUMBER: _ClassVar[int]
    file: File
    def __init__(self, file: _Optional[_Union[File, _Mapping]] = ...) -> None: ...

class GetUploadStatusRequest(_message.Message):
    __slots__ = ("upload_id",)
    UPLOAD_ID_FIELD_NUMBER: _ClassVar[int]
    upload_id: str
    def __init__(self, upload_id: _Optional[str] = ...) -> None: ...

class GetUploadStatusResponse(_message.Message):
    __slots__ = ("upload_id", "completed_chunks", "total_chunks", "status", "filename", "total_size")
    UPLOAD_ID_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_CHUNKS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_CHUNKS_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    TOTAL_SIZE_FIELD_NUMBER: _ClassVar[int]
    upload_id: str
    completed_chunks: _containers.RepeatedScalarFieldContainer[int]
    total_chunks: int
    status: UploadStatus
    filename: str
    total_size: int
    def __init__(self, upload_id: _Optional[str] = ..., completed_chunks: _Optional[_Iterable[int]] = ..., total_chunks: _Optional[int] = ..., status: _Optional[_Union[UploadStatus, str]] = ..., filename: _Optional[str] = ..., total_size: _Optional[int] = ...) -> None: ...

class AbortUploadRequest(_message.Message):
    __slots__ = ("upload_id",)
    UPLOAD_ID_FIELD_NUMBER: _ClassVar[int]
    upload_id: str
    def __init__(self, upload_id: _Optional[str] = ...) -> None: ...

class AbortUploadResponse(_message.Message):
    __slots__ = ("success", "message")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    success: bool
    message: str
    def __init__(self, success: _Optional[bool] = ..., message: _Optional[str] = ...) -> None: ...

class DownloadFileRequest(_message.Message):
    __slots__ = ("file_id", "organization_id", "version_id")
    FILE_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    VERSION_ID_FIELD_NUMBER: _ClassVar[int]
    file_id: str
    organization_id: str
    version_id: str
    def __init__(self, file_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., version_id: _Optional[str] = ...) -> None: ...

class DownloadFileResponse(_message.Message):
    __slots__ = ("data", "chunk_number", "total_chunks", "filename", "mime_type", "total_size")
    DATA_FIELD_NUMBER: _ClassVar[int]
    CHUNK_NUMBER_FIELD_NUMBER: _ClassVar[int]
    TOTAL_CHUNKS_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    MIME_TYPE_FIELD_NUMBER: _ClassVar[int]
    TOTAL_SIZE_FIELD_NUMBER: _ClassVar[int]
    data: bytes
    chunk_number: int
    total_chunks: int
    filename: str
    mime_type: str
    total_size: int
    def __init__(self, data: _Optional[bytes] = ..., chunk_number: _Optional[int] = ..., total_chunks: _Optional[int] = ..., filename: _Optional[str] = ..., mime_type: _Optional[str] = ..., total_size: _Optional[int] = ...) -> None: ...

class StreamFileRangeRequest(_message.Message):
    __slots__ = ("file_id", "organization_id", "start_byte", "end_byte")
    FILE_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    START_BYTE_FIELD_NUMBER: _ClassVar[int]
    END_BYTE_FIELD_NUMBER: _ClassVar[int]
    file_id: str
    organization_id: str
    start_byte: int
    end_byte: int
    def __init__(self, file_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., start_byte: _Optional[int] = ..., end_byte: _Optional[int] = ...) -> None: ...

class StreamFileRangeResponse(_message.Message):
    __slots__ = ("data", "total_size", "range_start", "range_end", "mime_type", "filename", "is_first_chunk")
    DATA_FIELD_NUMBER: _ClassVar[int]
    TOTAL_SIZE_FIELD_NUMBER: _ClassVar[int]
    RANGE_START_FIELD_NUMBER: _ClassVar[int]
    RANGE_END_FIELD_NUMBER: _ClassVar[int]
    MIME_TYPE_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    IS_FIRST_CHUNK_FIELD_NUMBER: _ClassVar[int]
    data: bytes
    total_size: int
    range_start: int
    range_end: int
    mime_type: str
    filename: str
    is_first_chunk: bool
    def __init__(self, data: _Optional[bytes] = ..., total_size: _Optional[int] = ..., range_start: _Optional[int] = ..., range_end: _Optional[int] = ..., mime_type: _Optional[str] = ..., filename: _Optional[str] = ..., is_first_chunk: _Optional[bool] = ...) -> None: ...

class File(_message.Message):
    __slots__ = ("id", "urn", "organization_id", "owner_id", "access_mode", "filename", "original_filename", "mime_type", "size_bytes", "folder_id", "description", "version", "extraction_status", "is_deleted", "created_at", "updated_at", "deleted_at", "group_ids", "user_role", "owner_info", "metadata", "baseline_role", "tags", "transcode_status")
    ID_FIELD_NUMBER: _ClassVar[int]
    URN_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    ORIGINAL_FILENAME_FIELD_NUMBER: _ClassVar[int]
    MIME_TYPE_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    FOLDER_ID_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    EXTRACTION_STATUS_FIELD_NUMBER: _ClassVar[int]
    IS_DELETED_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    DELETED_AT_FIELD_NUMBER: _ClassVar[int]
    GROUP_IDS_FIELD_NUMBER: _ClassVar[int]
    USER_ROLE_FIELD_NUMBER: _ClassVar[int]
    OWNER_INFO_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    TRANSCODE_STATUS_FIELD_NUMBER: _ClassVar[int]
    id: str
    urn: str
    organization_id: str
    owner_id: str
    access_mode: _common_pb2.AccessMode
    filename: str
    original_filename: str
    mime_type: str
    size_bytes: int
    folder_id: str
    description: str
    version: int
    extraction_status: ExtractionStatus
    is_deleted: bool
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    deleted_at: _timestamp_pb2.Timestamp
    group_ids: _containers.RepeatedScalarFieldContainer[str]
    user_role: _common_pb2.ContentRole
    owner_info: FileOwner
    metadata: FileMetadata
    baseline_role: _common_pb2.ContentRole
    tags: _containers.RepeatedCompositeFieldContainer[_tags_pb2.Tag]
    transcode_status: TranscodeStatus
    def __init__(self, id: _Optional[str] = ..., urn: _Optional[str] = ..., organization_id: _Optional[str] = ..., owner_id: _Optional[str] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., filename: _Optional[str] = ..., original_filename: _Optional[str] = ..., mime_type: _Optional[str] = ..., size_bytes: _Optional[int] = ..., folder_id: _Optional[str] = ..., description: _Optional[str] = ..., version: _Optional[int] = ..., extraction_status: _Optional[_Union[ExtractionStatus, str]] = ..., is_deleted: _Optional[bool] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., deleted_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., group_ids: _Optional[_Iterable[str]] = ..., user_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ..., owner_info: _Optional[_Union[FileOwner, _Mapping]] = ..., metadata: _Optional[_Union[FileMetadata, _Mapping]] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ..., tags: _Optional[_Iterable[_Union[_tags_pb2.Tag, _Mapping]]] = ..., transcode_status: _Optional[_Union[TranscodeStatus, str]] = ...) -> None: ...

class FileTagIds(_message.Message):
    __slots__ = ("ids",)
    IDS_FIELD_NUMBER: _ClassVar[int]
    ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, ids: _Optional[_Iterable[str]] = ...) -> None: ...

class FileMetadata(_message.Message):
    __slots__ = ("has_thumbnail", "width", "height", "format", "color_mode", "duration_seconds", "page_count", "exif", "error", "bitrate", "sample_rate", "channels")
    class ExifEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    HAS_THUMBNAIL_FIELD_NUMBER: _ClassVar[int]
    WIDTH_FIELD_NUMBER: _ClassVar[int]
    HEIGHT_FIELD_NUMBER: _ClassVar[int]
    FORMAT_FIELD_NUMBER: _ClassVar[int]
    COLOR_MODE_FIELD_NUMBER: _ClassVar[int]
    DURATION_SECONDS_FIELD_NUMBER: _ClassVar[int]
    PAGE_COUNT_FIELD_NUMBER: _ClassVar[int]
    EXIF_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    BITRATE_FIELD_NUMBER: _ClassVar[int]
    SAMPLE_RATE_FIELD_NUMBER: _ClassVar[int]
    CHANNELS_FIELD_NUMBER: _ClassVar[int]
    has_thumbnail: bool
    width: int
    height: int
    format: str
    color_mode: str
    duration_seconds: float
    page_count: int
    exif: _containers.ScalarMap[str, str]
    error: str
    bitrate: int
    sample_rate: int
    channels: int
    def __init__(self, has_thumbnail: _Optional[bool] = ..., width: _Optional[int] = ..., height: _Optional[int] = ..., format: _Optional[str] = ..., color_mode: _Optional[str] = ..., duration_seconds: _Optional[float] = ..., page_count: _Optional[int] = ..., exif: _Optional[_Mapping[str, str]] = ..., error: _Optional[str] = ..., bitrate: _Optional[int] = ..., sample_rate: _Optional[int] = ..., channels: _Optional[int] = ...) -> None: ...

class FileOwner(_message.Message):
    __slots__ = ("id", "name", "email")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    email: str
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., email: _Optional[str] = ...) -> None: ...

class GetFileResponse(_message.Message):
    __slots__ = ("file",)
    FILE_FIELD_NUMBER: _ClassVar[int]
    file: File
    def __init__(self, file: _Optional[_Union[File, _Mapping]] = ...) -> None: ...

class UpdateFileResponse(_message.Message):
    __slots__ = ("file",)
    FILE_FIELD_NUMBER: _ClassVar[int]
    file: File
    def __init__(self, file: _Optional[_Union[File, _Mapping]] = ...) -> None: ...

class RestoreFileResponse(_message.Message):
    __slots__ = ("file",)
    FILE_FIELD_NUMBER: _ClassVar[int]
    file: File
    def __init__(self, file: _Optional[_Union[File, _Mapping]] = ...) -> None: ...

class RestoreFileVersionResponse(_message.Message):
    __slots__ = ("file",)
    FILE_FIELD_NUMBER: _ClassVar[int]
    file: File
    def __init__(self, file: _Optional[_Union[File, _Mapping]] = ...) -> None: ...

class GetFileRequest(_message.Message):
    __slots__ = ("file_id", "organization_id")
    FILE_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    file_id: str
    organization_id: str
    def __init__(self, file_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class UpdateFileRequest(_message.Message):
    __slots__ = ("file_id", "organization_id", "filename", "description", "access_mode", "baseline_role", "tag_ids")
    FILE_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    TAG_IDS_FIELD_NUMBER: _ClassVar[int]
    file_id: str
    organization_id: str
    filename: str
    description: str
    access_mode: _common_pb2.AccessMode
    baseline_role: _common_pb2.ContentRole
    tag_ids: FileTagIds
    def __init__(self, file_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., filename: _Optional[str] = ..., description: _Optional[str] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ..., tag_ids: _Optional[_Union[FileTagIds, _Mapping]] = ...) -> None: ...

class DeleteFileRequest(_message.Message):
    __slots__ = ("file_id", "organization_id", "permanent")
    FILE_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PERMANENT_FIELD_NUMBER: _ClassVar[int]
    file_id: str
    organization_id: str
    permanent: bool
    def __init__(self, file_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., permanent: _Optional[bool] = ...) -> None: ...

class DeleteFileResponse(_message.Message):
    __slots__ = ("success", "message")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    success: bool
    message: str
    def __init__(self, success: _Optional[bool] = ..., message: _Optional[str] = ...) -> None: ...

class RestoreFileRequest(_message.Message):
    __slots__ = ("file_id", "organization_id")
    FILE_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    file_id: str
    organization_id: str
    def __init__(self, file_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class ListFilesRequest(_message.Message):
    __slots__ = ("organization_id", "folder_id", "include_deleted", "personal_only", "access_mode", "group_id", "page", "page_size", "sort_by", "sort_order", "shared_only", "tag_ids")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    FOLDER_ID_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_DELETED_FIELD_NUMBER: _ClassVar[int]
    PERSONAL_ONLY_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    GROUP_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    SORT_BY_FIELD_NUMBER: _ClassVar[int]
    SORT_ORDER_FIELD_NUMBER: _ClassVar[int]
    SHARED_ONLY_FIELD_NUMBER: _ClassVar[int]
    TAG_IDS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    folder_id: str
    include_deleted: bool
    personal_only: bool
    access_mode: _common_pb2.AccessMode
    group_id: str
    page: int
    page_size: int
    sort_by: str
    sort_order: str
    shared_only: bool
    tag_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, organization_id: _Optional[str] = ..., folder_id: _Optional[str] = ..., include_deleted: _Optional[bool] = ..., personal_only: _Optional[bool] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., group_id: _Optional[str] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ..., sort_by: _Optional[str] = ..., sort_order: _Optional[str] = ..., shared_only: _Optional[bool] = ..., tag_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class ListFilesResponse(_message.Message):
    __slots__ = ("files", "total_count", "page", "page_size", "total_pages")
    FILES_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    TOTAL_PAGES_FIELD_NUMBER: _ClassVar[int]
    files: _containers.RepeatedCompositeFieldContainer[File]
    total_count: int
    page: int
    page_size: int
    total_pages: int
    def __init__(self, files: _Optional[_Iterable[_Union[File, _Mapping]]] = ..., total_count: _Optional[int] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ..., total_pages: _Optional[int] = ...) -> None: ...

class Folder(_message.Message):
    __slots__ = ("id", "urn", "organization_id", "owner_id", "access_mode", "name", "parent_id", "is_deleted", "created_at", "updated_at", "is_system", "baseline_role")
    ID_FIELD_NUMBER: _ClassVar[int]
    URN_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    PARENT_ID_FIELD_NUMBER: _ClassVar[int]
    IS_DELETED_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    IS_SYSTEM_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    id: str
    urn: str
    organization_id: str
    owner_id: str
    access_mode: _common_pb2.AccessMode
    name: str
    parent_id: str
    is_deleted: bool
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    is_system: bool
    baseline_role: _common_pb2.ContentRole
    def __init__(self, id: _Optional[str] = ..., urn: _Optional[str] = ..., organization_id: _Optional[str] = ..., owner_id: _Optional[str] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., name: _Optional[str] = ..., parent_id: _Optional[str] = ..., is_deleted: _Optional[bool] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., is_system: _Optional[bool] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ...) -> None: ...

class CreateFolderResponse(_message.Message):
    __slots__ = ("folder",)
    FOLDER_FIELD_NUMBER: _ClassVar[int]
    folder: Folder
    def __init__(self, folder: _Optional[_Union[Folder, _Mapping]] = ...) -> None: ...

class UpdateFolderResponse(_message.Message):
    __slots__ = ("folder",)
    FOLDER_FIELD_NUMBER: _ClassVar[int]
    folder: Folder
    def __init__(self, folder: _Optional[_Union[Folder, _Mapping]] = ...) -> None: ...

class EnsureRecordingsFolderResponse(_message.Message):
    __slots__ = ("folder",)
    FOLDER_FIELD_NUMBER: _ClassVar[int]
    folder: Folder
    def __init__(self, folder: _Optional[_Union[Folder, _Mapping]] = ...) -> None: ...

class RestoreFolderResponse(_message.Message):
    __slots__ = ("folder",)
    FOLDER_FIELD_NUMBER: _ClassVar[int]
    folder: Folder
    def __init__(self, folder: _Optional[_Union[Folder, _Mapping]] = ...) -> None: ...

class CreateFolderRequest(_message.Message):
    __slots__ = ("organization_id", "name", "parent_id", "access_mode", "baseline_role")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    PARENT_ID_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    name: str
    parent_id: str
    access_mode: _common_pb2.AccessMode
    baseline_role: _common_pb2.ContentRole
    def __init__(self, organization_id: _Optional[str] = ..., name: _Optional[str] = ..., parent_id: _Optional[str] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ...) -> None: ...

class UpdateFolderRequest(_message.Message):
    __slots__ = ("folder_id", "organization_id", "name", "parent_id", "access_mode", "baseline_role")
    FOLDER_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    PARENT_ID_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    folder_id: str
    organization_id: str
    name: str
    parent_id: str
    access_mode: _common_pb2.AccessMode
    baseline_role: _common_pb2.ContentRole
    def __init__(self, folder_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., name: _Optional[str] = ..., parent_id: _Optional[str] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ...) -> None: ...

class DeleteFolderRequest(_message.Message):
    __slots__ = ("folder_id", "organization_id", "permanent", "recursive")
    FOLDER_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PERMANENT_FIELD_NUMBER: _ClassVar[int]
    RECURSIVE_FIELD_NUMBER: _ClassVar[int]
    folder_id: str
    organization_id: str
    permanent: bool
    recursive: bool
    def __init__(self, folder_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., permanent: _Optional[bool] = ..., recursive: _Optional[bool] = ...) -> None: ...

class DeleteFolderResponse(_message.Message):
    __slots__ = ("success", "message", "files_deleted", "folders_deleted")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    FILES_DELETED_FIELD_NUMBER: _ClassVar[int]
    FOLDERS_DELETED_FIELD_NUMBER: _ClassVar[int]
    success: bool
    message: str
    files_deleted: int
    folders_deleted: int
    def __init__(self, success: _Optional[bool] = ..., message: _Optional[str] = ..., files_deleted: _Optional[int] = ..., folders_deleted: _Optional[int] = ...) -> None: ...

class GetFilesTreeRequest(_message.Message):
    __slots__ = ("organization_id", "root_folder_id", "include_files", "personal_only")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ROOT_FOLDER_ID_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_FILES_FIELD_NUMBER: _ClassVar[int]
    PERSONAL_ONLY_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    root_folder_id: str
    include_files: bool
    personal_only: bool
    def __init__(self, organization_id: _Optional[str] = ..., root_folder_id: _Optional[str] = ..., include_files: _Optional[bool] = ..., personal_only: _Optional[bool] = ...) -> None: ...

class GetFilesTreeResponse(_message.Message):
    __slots__ = ("nodes",)
    NODES_FIELD_NUMBER: _ClassVar[int]
    nodes: _containers.RepeatedCompositeFieldContainer[TreeNode]
    def __init__(self, nodes: _Optional[_Iterable[_Union[TreeNode, _Mapping]]] = ...) -> None: ...

class TreeNode(_message.Message):
    __slots__ = ("id", "name", "is_folder", "parent_id", "access_mode", "child_count", "size_bytes", "mime_type", "children", "baseline_role")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    IS_FOLDER_FIELD_NUMBER: _ClassVar[int]
    PARENT_ID_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    CHILD_COUNT_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    MIME_TYPE_FIELD_NUMBER: _ClassVar[int]
    CHILDREN_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    is_folder: bool
    parent_id: str
    access_mode: _common_pb2.AccessMode
    child_count: int
    size_bytes: int
    mime_type: str
    children: _containers.RepeatedCompositeFieldContainer[TreeNode]
    baseline_role: _common_pb2.ContentRole
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., is_folder: _Optional[bool] = ..., parent_id: _Optional[str] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., child_count: _Optional[int] = ..., size_bytes: _Optional[int] = ..., mime_type: _Optional[str] = ..., children: _Optional[_Iterable[_Union[TreeNode, _Mapping]]] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ...) -> None: ...

class MoveItemsRequest(_message.Message):
    __slots__ = ("organization_id", "file_ids", "folder_ids", "target_folder_id", "target_access_mode", "target_baseline_role")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    FILE_IDS_FIELD_NUMBER: _ClassVar[int]
    FOLDER_IDS_FIELD_NUMBER: _ClassVar[int]
    TARGET_FOLDER_ID_FIELD_NUMBER: _ClassVar[int]
    TARGET_ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    TARGET_BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    file_ids: _containers.RepeatedScalarFieldContainer[str]
    folder_ids: _containers.RepeatedScalarFieldContainer[str]
    target_folder_id: str
    target_access_mode: _common_pb2.AccessMode
    target_baseline_role: _common_pb2.ContentRole
    def __init__(self, organization_id: _Optional[str] = ..., file_ids: _Optional[_Iterable[str]] = ..., folder_ids: _Optional[_Iterable[str]] = ..., target_folder_id: _Optional[str] = ..., target_access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., target_baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ...) -> None: ...

class MoveItemsResponse(_message.Message):
    __slots__ = ("success", "message", "files_moved", "folders_moved")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    FILES_MOVED_FIELD_NUMBER: _ClassVar[int]
    FOLDERS_MOVED_FIELD_NUMBER: _ClassVar[int]
    success: bool
    message: str
    files_moved: int
    folders_moved: int
    def __init__(self, success: _Optional[bool] = ..., message: _Optional[str] = ..., files_moved: _Optional[int] = ..., folders_moved: _Optional[int] = ...) -> None: ...

class CopyItemsRequest(_message.Message):
    __slots__ = ("organization_id", "file_ids", "target_folder_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    FILE_IDS_FIELD_NUMBER: _ClassVar[int]
    TARGET_FOLDER_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    file_ids: _containers.RepeatedScalarFieldContainer[str]
    target_folder_id: str
    def __init__(self, organization_id: _Optional[str] = ..., file_ids: _Optional[_Iterable[str]] = ..., target_folder_id: _Optional[str] = ...) -> None: ...

class CopyItemsResponse(_message.Message):
    __slots__ = ("success", "message", "copied_files")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    COPIED_FILES_FIELD_NUMBER: _ClassVar[int]
    success: bool
    message: str
    copied_files: _containers.RepeatedCompositeFieldContainer[File]
    def __init__(self, success: _Optional[bool] = ..., message: _Optional[str] = ..., copied_files: _Optional[_Iterable[_Union[File, _Mapping]]] = ...) -> None: ...

class BulkDeleteRequest(_message.Message):
    __slots__ = ("organization_id", "file_ids", "folder_ids", "permanent")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    FILE_IDS_FIELD_NUMBER: _ClassVar[int]
    FOLDER_IDS_FIELD_NUMBER: _ClassVar[int]
    PERMANENT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    file_ids: _containers.RepeatedScalarFieldContainer[str]
    folder_ids: _containers.RepeatedScalarFieldContainer[str]
    permanent: bool
    def __init__(self, organization_id: _Optional[str] = ..., file_ids: _Optional[_Iterable[str]] = ..., folder_ids: _Optional[_Iterable[str]] = ..., permanent: _Optional[bool] = ...) -> None: ...

class BulkDeleteResponse(_message.Message):
    __slots__ = ("success", "message", "files_deleted", "folders_deleted")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    FILES_DELETED_FIELD_NUMBER: _ClassVar[int]
    FOLDERS_DELETED_FIELD_NUMBER: _ClassVar[int]
    success: bool
    message: str
    files_deleted: int
    folders_deleted: int
    def __init__(self, success: _Optional[bool] = ..., message: _Optional[str] = ..., files_deleted: _Optional[int] = ..., folders_deleted: _Optional[int] = ...) -> None: ...

class EmptyTrashRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class EmptyTrashResponse(_message.Message):
    __slots__ = ("success", "message", "files_deleted", "folders_deleted")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    FILES_DELETED_FIELD_NUMBER: _ClassVar[int]
    FOLDERS_DELETED_FIELD_NUMBER: _ClassVar[int]
    success: bool
    message: str
    files_deleted: int
    folders_deleted: int
    def __init__(self, success: _Optional[bool] = ..., message: _Optional[str] = ..., files_deleted: _Optional[int] = ..., folders_deleted: _Optional[int] = ...) -> None: ...

class ListTrashRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class ListTrashResponse(_message.Message):
    __slots__ = ("files", "folders")
    FILES_FIELD_NUMBER: _ClassVar[int]
    FOLDERS_FIELD_NUMBER: _ClassVar[int]
    files: _containers.RepeatedCompositeFieldContainer[File]
    folders: _containers.RepeatedCompositeFieldContainer[Folder]
    def __init__(self, files: _Optional[_Iterable[_Union[File, _Mapping]]] = ..., folders: _Optional[_Iterable[_Union[Folder, _Mapping]]] = ...) -> None: ...

class RestoreFolderRequest(_message.Message):
    __slots__ = ("folder_id", "organization_id")
    FOLDER_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    folder_id: str
    organization_id: str
    def __init__(self, folder_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class FileVersion(_message.Message):
    __slots__ = ("id", "file_id", "version_number", "size_bytes", "checksum_sha256", "uploaded_by", "created_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    FILE_ID_FIELD_NUMBER: _ClassVar[int]
    VERSION_NUMBER_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    CHECKSUM_SHA256_FIELD_NUMBER: _ClassVar[int]
    UPLOADED_BY_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    file_id: str
    version_number: int
    size_bytes: int
    checksum_sha256: str
    uploaded_by: str
    created_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., file_id: _Optional[str] = ..., version_number: _Optional[int] = ..., size_bytes: _Optional[int] = ..., checksum_sha256: _Optional[str] = ..., uploaded_by: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ListFileVersionsRequest(_message.Message):
    __slots__ = ("file_id", "organization_id")
    FILE_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    file_id: str
    organization_id: str
    def __init__(self, file_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class ListFileVersionsResponse(_message.Message):
    __slots__ = ("versions",)
    VERSIONS_FIELD_NUMBER: _ClassVar[int]
    versions: _containers.RepeatedCompositeFieldContainer[FileVersion]
    def __init__(self, versions: _Optional[_Iterable[_Union[FileVersion, _Mapping]]] = ...) -> None: ...

class RestoreFileVersionRequest(_message.Message):
    __slots__ = ("file_id", "organization_id", "version_id")
    FILE_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    VERSION_ID_FIELD_NUMBER: _ClassVar[int]
    file_id: str
    organization_id: str
    version_id: str
    def __init__(self, file_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., version_id: _Optional[str] = ...) -> None: ...

class FilterCriteria(_message.Message):
    __slots__ = ("extensions", "mime_categories", "owner_ids", "access_mode", "size_min_bytes", "size_max_bytes", "created_after", "created_before", "tag_ids")
    EXTENSIONS_FIELD_NUMBER: _ClassVar[int]
    MIME_CATEGORIES_FIELD_NUMBER: _ClassVar[int]
    OWNER_IDS_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    SIZE_MIN_BYTES_FIELD_NUMBER: _ClassVar[int]
    SIZE_MAX_BYTES_FIELD_NUMBER: _ClassVar[int]
    CREATED_AFTER_FIELD_NUMBER: _ClassVar[int]
    CREATED_BEFORE_FIELD_NUMBER: _ClassVar[int]
    TAG_IDS_FIELD_NUMBER: _ClassVar[int]
    extensions: _containers.RepeatedScalarFieldContainer[str]
    mime_categories: _containers.RepeatedScalarFieldContainer[str]
    owner_ids: _containers.RepeatedScalarFieldContainer[str]
    access_mode: _common_pb2.AccessMode
    size_min_bytes: int
    size_max_bytes: int
    created_after: _timestamp_pb2.Timestamp
    created_before: _timestamp_pb2.Timestamp
    tag_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, extensions: _Optional[_Iterable[str]] = ..., mime_categories: _Optional[_Iterable[str]] = ..., owner_ids: _Optional[_Iterable[str]] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., size_min_bytes: _Optional[int] = ..., size_max_bytes: _Optional[int] = ..., created_after: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., created_before: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., tag_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class IconValue(_message.Message):
    __slots__ = ("type", "value")
    TYPE_FIELD_NUMBER: _ClassVar[int]
    VALUE_FIELD_NUMBER: _ClassVar[int]
    type: str
    value: str
    def __init__(self, type: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...

class SavedFilter(_message.Message):
    __slots__ = ("id", "user_id", "organization_id", "name", "description", "icon", "criteria", "is_preset", "sort_by", "sort_order", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ICON_FIELD_NUMBER: _ClassVar[int]
    CRITERIA_FIELD_NUMBER: _ClassVar[int]
    IS_PRESET_FIELD_NUMBER: _ClassVar[int]
    SORT_BY_FIELD_NUMBER: _ClassVar[int]
    SORT_ORDER_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    user_id: str
    organization_id: str
    name: str
    description: str
    icon: IconValue
    criteria: FilterCriteria
    is_preset: bool
    sort_by: str
    sort_order: str
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., user_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., icon: _Optional[_Union[IconValue, _Mapping]] = ..., criteria: _Optional[_Union[FilterCriteria, _Mapping]] = ..., is_preset: _Optional[bool] = ..., sort_by: _Optional[str] = ..., sort_order: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class CreateSavedFilterResponse(_message.Message):
    __slots__ = ("filter",)
    FILTER_FIELD_NUMBER: _ClassVar[int]
    filter: SavedFilter
    def __init__(self, filter: _Optional[_Union[SavedFilter, _Mapping]] = ...) -> None: ...

class GetSavedFilterResponse(_message.Message):
    __slots__ = ("filter",)
    FILTER_FIELD_NUMBER: _ClassVar[int]
    filter: SavedFilter
    def __init__(self, filter: _Optional[_Union[SavedFilter, _Mapping]] = ...) -> None: ...

class UpdateSavedFilterResponse(_message.Message):
    __slots__ = ("filter",)
    FILTER_FIELD_NUMBER: _ClassVar[int]
    filter: SavedFilter
    def __init__(self, filter: _Optional[_Union[SavedFilter, _Mapping]] = ...) -> None: ...

class CreateSavedFilterRequest(_message.Message):
    __slots__ = ("organization_id", "name", "description", "icon", "criteria", "sort_by", "sort_order")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ICON_FIELD_NUMBER: _ClassVar[int]
    CRITERIA_FIELD_NUMBER: _ClassVar[int]
    SORT_BY_FIELD_NUMBER: _ClassVar[int]
    SORT_ORDER_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    name: str
    description: str
    icon: IconValue
    criteria: FilterCriteria
    sort_by: str
    sort_order: str
    def __init__(self, organization_id: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., icon: _Optional[_Union[IconValue, _Mapping]] = ..., criteria: _Optional[_Union[FilterCriteria, _Mapping]] = ..., sort_by: _Optional[str] = ..., sort_order: _Optional[str] = ...) -> None: ...

class GetSavedFilterRequest(_message.Message):
    __slots__ = ("filter_id", "organization_id")
    FILTER_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    filter_id: str
    organization_id: str
    def __init__(self, filter_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class UpdateSavedFilterRequest(_message.Message):
    __slots__ = ("filter_id", "organization_id", "name", "description", "icon", "criteria", "sort_by", "sort_order")
    FILTER_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ICON_FIELD_NUMBER: _ClassVar[int]
    CRITERIA_FIELD_NUMBER: _ClassVar[int]
    SORT_BY_FIELD_NUMBER: _ClassVar[int]
    SORT_ORDER_FIELD_NUMBER: _ClassVar[int]
    filter_id: str
    organization_id: str
    name: str
    description: str
    icon: IconValue
    criteria: FilterCriteria
    sort_by: str
    sort_order: str
    def __init__(self, filter_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., icon: _Optional[_Union[IconValue, _Mapping]] = ..., criteria: _Optional[_Union[FilterCriteria, _Mapping]] = ..., sort_by: _Optional[str] = ..., sort_order: _Optional[str] = ...) -> None: ...

class DeleteSavedFilterRequest(_message.Message):
    __slots__ = ("filter_id", "organization_id")
    FILTER_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    filter_id: str
    organization_id: str
    def __init__(self, filter_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class DeleteSavedFilterResponse(_message.Message):
    __slots__ = ("success", "message")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    success: bool
    message: str
    def __init__(self, success: _Optional[bool] = ..., message: _Optional[str] = ...) -> None: ...

class ListSavedFiltersRequest(_message.Message):
    __slots__ = ("organization_id", "include_presets")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_PRESETS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    include_presets: bool
    def __init__(self, organization_id: _Optional[str] = ..., include_presets: _Optional[bool] = ...) -> None: ...

class ListSavedFiltersResponse(_message.Message):
    __slots__ = ("filters",)
    FILTERS_FIELD_NUMBER: _ClassVar[int]
    filters: _containers.RepeatedCompositeFieldContainer[SavedFilter]
    def __init__(self, filters: _Optional[_Iterable[_Union[SavedFilter, _Mapping]]] = ...) -> None: ...

class OrgStorageQuota(_message.Message):
    __slots__ = ("id", "organization_id", "org_quota_bytes", "default_user_quota_bytes", "warn_at_percent", "enforce", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ORG_QUOTA_BYTES_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_USER_QUOTA_BYTES_FIELD_NUMBER: _ClassVar[int]
    WARN_AT_PERCENT_FIELD_NUMBER: _ClassVar[int]
    ENFORCE_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    org_quota_bytes: int
    default_user_quota_bytes: int
    warn_at_percent: int
    enforce: bool
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., org_quota_bytes: _Optional[int] = ..., default_user_quota_bytes: _Optional[int] = ..., warn_at_percent: _Optional[int] = ..., enforce: _Optional[bool] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class GetOrgStorageQuotaRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class GetOrgStorageQuotaResponse(_message.Message):
    __slots__ = ("quota", "total_used_bytes", "total_file_count")
    QUOTA_FIELD_NUMBER: _ClassVar[int]
    TOTAL_USED_BYTES_FIELD_NUMBER: _ClassVar[int]
    TOTAL_FILE_COUNT_FIELD_NUMBER: _ClassVar[int]
    quota: OrgStorageQuota
    total_used_bytes: int
    total_file_count: int
    def __init__(self, quota: _Optional[_Union[OrgStorageQuota, _Mapping]] = ..., total_used_bytes: _Optional[int] = ..., total_file_count: _Optional[int] = ...) -> None: ...

class SetOrgStorageQuotaRequest(_message.Message):
    __slots__ = ("organization_id", "org_quota_bytes", "default_user_quota_bytes", "warn_at_percent", "enforce")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ORG_QUOTA_BYTES_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_USER_QUOTA_BYTES_FIELD_NUMBER: _ClassVar[int]
    WARN_AT_PERCENT_FIELD_NUMBER: _ClassVar[int]
    ENFORCE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    org_quota_bytes: int
    default_user_quota_bytes: int
    warn_at_percent: int
    enforce: bool
    def __init__(self, organization_id: _Optional[str] = ..., org_quota_bytes: _Optional[int] = ..., default_user_quota_bytes: _Optional[int] = ..., warn_at_percent: _Optional[int] = ..., enforce: _Optional[bool] = ...) -> None: ...

class SetOrgStorageQuotaResponse(_message.Message):
    __slots__ = ("quota",)
    QUOTA_FIELD_NUMBER: _ClassVar[int]
    quota: OrgStorageQuota
    def __init__(self, quota: _Optional[_Union[OrgStorageQuota, _Mapping]] = ...) -> None: ...

class UserStorageQuotaOverrideInfo(_message.Message):
    __slots__ = ("id", "organization_id", "user_id", "quota_bytes", "note", "created_by", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    QUOTA_BYTES_FIELD_NUMBER: _ClassVar[int]
    NOTE_FIELD_NUMBER: _ClassVar[int]
    CREATED_BY_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    user_id: str
    quota_bytes: int
    note: str
    created_by: str
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., user_id: _Optional[str] = ..., quota_bytes: _Optional[int] = ..., note: _Optional[str] = ..., created_by: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class GetUserStorageQuotaRequest(_message.Message):
    __slots__ = ("organization_id", "user_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    user_id: str
    def __init__(self, organization_id: _Optional[str] = ..., user_id: _Optional[str] = ...) -> None: ...

class GetUserStorageQuotaResponse(_message.Message):
    __slots__ = ("effective_quota_bytes", "used_bytes", "file_count", "usage_percent", "override")
    EFFECTIVE_QUOTA_BYTES_FIELD_NUMBER: _ClassVar[int]
    USED_BYTES_FIELD_NUMBER: _ClassVar[int]
    FILE_COUNT_FIELD_NUMBER: _ClassVar[int]
    USAGE_PERCENT_FIELD_NUMBER: _ClassVar[int]
    OVERRIDE_FIELD_NUMBER: _ClassVar[int]
    effective_quota_bytes: int
    used_bytes: int
    file_count: int
    usage_percent: float
    override: UserStorageQuotaOverrideInfo
    def __init__(self, effective_quota_bytes: _Optional[int] = ..., used_bytes: _Optional[int] = ..., file_count: _Optional[int] = ..., usage_percent: _Optional[float] = ..., override: _Optional[_Union[UserStorageQuotaOverrideInfo, _Mapping]] = ...) -> None: ...

class SetUserStorageQuotaOverrideRequest(_message.Message):
    __slots__ = ("organization_id", "user_id", "quota_bytes", "note")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    QUOTA_BYTES_FIELD_NUMBER: _ClassVar[int]
    NOTE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    user_id: str
    quota_bytes: int
    note: str
    def __init__(self, organization_id: _Optional[str] = ..., user_id: _Optional[str] = ..., quota_bytes: _Optional[int] = ..., note: _Optional[str] = ...) -> None: ...

class SetUserStorageQuotaOverrideResponse(_message.Message):
    __slots__ = ("override",)
    OVERRIDE_FIELD_NUMBER: _ClassVar[int]
    override: UserStorageQuotaOverrideInfo
    def __init__(self, override: _Optional[_Union[UserStorageQuotaOverrideInfo, _Mapping]] = ...) -> None: ...

class RemoveUserStorageQuotaOverrideRequest(_message.Message):
    __slots__ = ("organization_id", "user_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    user_id: str
    def __init__(self, organization_id: _Optional[str] = ..., user_id: _Optional[str] = ...) -> None: ...

class RemoveUserStorageQuotaOverrideResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class ListUserStorageQuotaOverridesRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class ListUserStorageQuotaOverridesResponse(_message.Message):
    __slots__ = ("overrides",)
    OVERRIDES_FIELD_NUMBER: _ClassVar[int]
    overrides: _containers.RepeatedCompositeFieldContainer[UserStorageQuotaOverrideInfo]
    def __init__(self, overrides: _Optional[_Iterable[_Union[UserStorageQuotaOverrideInfo, _Mapping]]] = ...) -> None: ...

class StorageUsageInfo(_message.Message):
    __slots__ = ("user_id", "organization_id", "used_bytes", "file_count", "effective_quota_bytes", "usage_percent", "has_override", "last_recalculated_at")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USED_BYTES_FIELD_NUMBER: _ClassVar[int]
    FILE_COUNT_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_QUOTA_BYTES_FIELD_NUMBER: _ClassVar[int]
    USAGE_PERCENT_FIELD_NUMBER: _ClassVar[int]
    HAS_OVERRIDE_FIELD_NUMBER: _ClassVar[int]
    LAST_RECALCULATED_AT_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    organization_id: str
    used_bytes: int
    file_count: int
    effective_quota_bytes: int
    usage_percent: float
    has_override: bool
    last_recalculated_at: _timestamp_pb2.Timestamp
    def __init__(self, user_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., used_bytes: _Optional[int] = ..., file_count: _Optional[int] = ..., effective_quota_bytes: _Optional[int] = ..., usage_percent: _Optional[float] = ..., has_override: _Optional[bool] = ..., last_recalculated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class GetStorageUsageRequest(_message.Message):
    __slots__ = ("organization_id", "user_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    user_id: str
    def __init__(self, organization_id: _Optional[str] = ..., user_id: _Optional[str] = ...) -> None: ...

class GetStorageUsageResponse(_message.Message):
    __slots__ = ("usage",)
    USAGE_FIELD_NUMBER: _ClassVar[int]
    usage: StorageUsageInfo
    def __init__(self, usage: _Optional[_Union[StorageUsageInfo, _Mapping]] = ...) -> None: ...

class ListOrgStorageUsageRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class ListOrgStorageUsageResponse(_message.Message):
    __slots__ = ("users", "total_used_bytes", "total_file_count")
    USERS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_USED_BYTES_FIELD_NUMBER: _ClassVar[int]
    TOTAL_FILE_COUNT_FIELD_NUMBER: _ClassVar[int]
    users: _containers.RepeatedCompositeFieldContainer[StorageUsageInfo]
    total_used_bytes: int
    total_file_count: int
    def __init__(self, users: _Optional[_Iterable[_Union[StorageUsageInfo, _Mapping]]] = ..., total_used_bytes: _Optional[int] = ..., total_file_count: _Optional[int] = ...) -> None: ...

class RecalculateStorageUsageRequest(_message.Message):
    __slots__ = ("organization_id", "user_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    user_id: str
    def __init__(self, organization_id: _Optional[str] = ..., user_id: _Optional[str] = ...) -> None: ...

class RecalculateStorageUsageResponse(_message.Message):
    __slots__ = ("recalculated",)
    RECALCULATED_FIELD_NUMBER: _ClassVar[int]
    recalculated: _containers.RepeatedCompositeFieldContainer[StorageUsageInfo]
    def __init__(self, recalculated: _Optional[_Iterable[_Union[StorageUsageInfo, _Mapping]]] = ...) -> None: ...

class CheckStorageQuotaRequest(_message.Message):
    __slots__ = ("organization_id", "additional_bytes")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ADDITIONAL_BYTES_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    additional_bytes: int
    def __init__(self, organization_id: _Optional[str] = ..., additional_bytes: _Optional[int] = ...) -> None: ...

class CheckStorageQuotaResponse(_message.Message):
    __slots__ = ("allowed", "reason", "current_used_bytes", "quota_bytes", "remaining_bytes", "usage_percent")
    ALLOWED_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    CURRENT_USED_BYTES_FIELD_NUMBER: _ClassVar[int]
    QUOTA_BYTES_FIELD_NUMBER: _ClassVar[int]
    REMAINING_BYTES_FIELD_NUMBER: _ClassVar[int]
    USAGE_PERCENT_FIELD_NUMBER: _ClassVar[int]
    allowed: bool
    reason: str
    current_used_bytes: int
    quota_bytes: int
    remaining_bytes: int
    usage_percent: float
    def __init__(self, allowed: _Optional[bool] = ..., reason: _Optional[str] = ..., current_used_bytes: _Optional[int] = ..., quota_bytes: _Optional[int] = ..., remaining_bytes: _Optional[int] = ..., usage_percent: _Optional[float] = ...) -> None: ...

class FolderTreeNode(_message.Message):
    __slots__ = ("name", "children")
    NAME_FIELD_NUMBER: _ClassVar[int]
    CHILDREN_FIELD_NUMBER: _ClassVar[int]
    name: str
    children: _containers.RepeatedCompositeFieldContainer[FolderTreeNode]
    def __init__(self, name: _Optional[str] = ..., children: _Optional[_Iterable[_Union[FolderTreeNode, _Mapping]]] = ...) -> None: ...

class CreatedFolderInfo(_message.Message):
    __slots__ = ("id", "name", "path", "parent_id")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    PATH_FIELD_NUMBER: _ClassVar[int]
    PARENT_ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    path: str
    parent_id: str
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., path: _Optional[str] = ..., parent_id: _Optional[str] = ...) -> None: ...

class CreateFolderTreeRequest(_message.Message):
    __slots__ = ("organization_id", "parent_folder_id", "tree", "access_mode", "baseline_role")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PARENT_FOLDER_ID_FIELD_NUMBER: _ClassVar[int]
    TREE_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    parent_folder_id: str
    tree: _containers.RepeatedCompositeFieldContainer[FolderTreeNode]
    access_mode: _common_pb2.AccessMode
    baseline_role: _common_pb2.ContentRole
    def __init__(self, organization_id: _Optional[str] = ..., parent_folder_id: _Optional[str] = ..., tree: _Optional[_Iterable[_Union[FolderTreeNode, _Mapping]]] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ...) -> None: ...

class CreateFolderTreeResponse(_message.Message):
    __slots__ = ("folders",)
    FOLDERS_FIELD_NUMBER: _ClassVar[int]
    folders: _containers.RepeatedCompositeFieldContainer[CreatedFolderInfo]
    def __init__(self, folders: _Optional[_Iterable[_Union[CreatedFolderInfo, _Mapping]]] = ...) -> None: ...

class EnsureRecordingsFolderRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...
