"""Proto <-> domain converters for files domain."""

from uniffy_proto.files.v1.files_pb2 import (
    ExtractionStatus as ProtoExtractionStatus,
)
from uniffy_proto.files.v1.files_pb2 import (
    File as ProtoFile,
)
from uniffy_proto.files.v1.files_pb2 import (
    FileMetadata as ProtoFileMetadata,
)
from uniffy_proto.files.v1.files_pb2 import (
    FileOwner as ProtoFileOwner,
)
from uniffy_proto.files.v1.files_pb2 import (
    FileVersion as ProtoFileVersion,
)
from uniffy_proto.files.v1.files_pb2 import (
    Folder as ProtoFolder,
)
from uniffy_proto.files.v1.files_pb2 import PlaybackStatus as ProtoPlaybackStatus
from uniffy_proto.files.v1.files_pb2 import (
    TranscodeStatus as ProtoTranscodeStatus,
)
from uniffy_proto.files.v1.files_pb2 import (
    TreeNode as ProtoTreeNode,
)
from uniffy_proto.files.v1.files_pb2 import (
    UploadStatus as ProtoUploadStatus,
)

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.converters.common_proto import (
    access_mode_to_proto,
    content_role_to_proto,
)
from uniffy.core.models.files.file import ExtractionStatus, File, PlaybackStatus, TranscodeStatus
from uniffy.core.models.files.file_version import FileVersion
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.files.media_info import FileMediaInfo
from uniffy.core.models.files.multipart_upload import MultipartUpload, UploadStatus
from uniffy.core.models.tags.tag import Tag
from uniffy.core.types import AccessMode, ContentRole
from uniffy.domains.tags.converters import tag_to_proto

EXTRACTION_STATUS_TO_PROTO = {
    ExtractionStatus.PENDING: ProtoExtractionStatus.EXTRACTION_STATUS_PENDING,
    ExtractionStatus.PROCESSING: ProtoExtractionStatus.EXTRACTION_STATUS_PROCESSING,
    ExtractionStatus.COMPLETED: ProtoExtractionStatus.EXTRACTION_STATUS_COMPLETED,
    ExtractionStatus.FAILED: ProtoExtractionStatus.EXTRACTION_STATUS_FAILED,
    ExtractionStatus.SKIPPED: ProtoExtractionStatus.EXTRACTION_STATUS_SKIPPED,
}

TRANSCODE_STATUS_TO_PROTO = {
    TranscodeStatus.NOT_NEEDED: ProtoTranscodeStatus.TRANSCODE_STATUS_NOT_NEEDED,
    TranscodeStatus.PENDING: ProtoTranscodeStatus.TRANSCODE_STATUS_PENDING,
    TranscodeStatus.PROCESSING: ProtoTranscodeStatus.TRANSCODE_STATUS_PROCESSING,
    TranscodeStatus.COMPLETED: ProtoTranscodeStatus.TRANSCODE_STATUS_COMPLETED,
    TranscodeStatus.FAILED: ProtoTranscodeStatus.TRANSCODE_STATUS_FAILED,
}

PLAYBACK_STATUS_TO_PROTO = {
    PlaybackStatus.NOT_NEEDED: ProtoPlaybackStatus.PLAYBACK_STATUS_NOT_NEEDED,
    PlaybackStatus.PENDING: ProtoPlaybackStatus.PLAYBACK_STATUS_PENDING,
    PlaybackStatus.PROCESSING: ProtoPlaybackStatus.PLAYBACK_STATUS_PROCESSING,
    PlaybackStatus.COMPLETED: ProtoPlaybackStatus.PLAYBACK_STATUS_COMPLETED,
    PlaybackStatus.FAILED: ProtoPlaybackStatus.PLAYBACK_STATUS_FAILED,
}

UPLOAD_STATUS_TO_PROTO = {
    UploadStatus.ACTIVE: ProtoUploadStatus.UPLOAD_STATUS_ACTIVE,
    UploadStatus.COMPLETED: ProtoUploadStatus.UPLOAD_STATUS_COMPLETED,
    UploadStatus.ABORTED: ProtoUploadStatus.UPLOAD_STATUS_ABORTED,
    UploadStatus.EXPIRED: ProtoUploadStatus.UPLOAD_STATUS_EXPIRED,
}


def file_to_proto(
    file: File,
    user_role: ContentRole | None = None,
    owner_info: dict | None = None,
    group_ids: list[str] | None = None,
    tags: list[Tag] | None = None,
    effective_access_mode: AccessMode | None = None,
    effective_baseline_role: ContentRole | None = None,
) -> ProtoFile:
    proto_extraction = EXTRACTION_STATUS_TO_PROTO.get(
        file.extraction_status,
        ProtoExtractionStatus.EXTRACTION_STATUS_PENDING,
    )
    proto_transcode = TRANSCODE_STATUS_TO_PROTO.get(
        file.transcode_status,
        ProtoTranscodeStatus.TRANSCODE_STATUS_NOT_NEEDED,
    )

    resolved_mode = effective_access_mode if effective_access_mode is not None else file.access_mode
    resolved_baseline = (
        effective_baseline_role if effective_baseline_role is not None else file.baseline_role
    )
    proto_file = ProtoFile(
        id=str(file.id),
        urn=file.urn,
        organization_id=str(file.organization_id),
        owner_id=str(file.owner_id),
        access_mode=access_mode_to_proto(resolved_mode) if resolved_mode is not None else 0,
        filename=file.filename,
        original_filename=file.original_filename,
        mime_type=file.mime_type,
        size_bytes=file.size_bytes,
        version=file.version,
        extraction_status=proto_extraction,
        transcode_status=proto_transcode,
        playback_status=PLAYBACK_STATUS_TO_PROTO.get(
            file.playback_status, ProtoPlaybackStatus.PLAYBACK_STATUS_NOT_NEEDED
        ),
        is_deleted=file.is_deleted,
        created_at=datetime_to_timestamp(file.created_at),
        updated_at=datetime_to_timestamp(file.updated_at),
        group_ids=group_ids or [],
        tags=[tag_to_proto(t) for t in tags] if tags else [],
    )

    if resolved_baseline is not None:
        proto_file.baseline_role = content_role_to_proto(resolved_baseline)

    if user_role is not None:
        proto_file.user_role = content_role_to_proto(user_role)

    if file.folder_id:
        proto_file.folder_id = str(file.folder_id)

    if file.description:
        proto_file.description = file.description

    if file.deleted_at:
        proto_file.deleted_at.CopyFrom(datetime_to_timestamp(file.deleted_at))

    if owner_info:
        proto_file.owner_info.CopyFrom(
            ProtoFileOwner(
                id=str(owner_info.get("id", "")),
                name=owner_info.get("name", ""),
                email=owner_info.get("email", ""),
            )
        )

    if file.media_info:
        proto_file.metadata.CopyFrom(_build_file_metadata_from_model(file.media_info))

    return proto_file


def _build_file_metadata_from_model(info: FileMediaInfo) -> ProtoFileMetadata:
    proto_meta = ProtoFileMetadata(
        has_thumbnail=info.thumbnail_key is not None,
    )

    if info.width is not None:
        proto_meta.width = info.width
    if info.height is not None:
        proto_meta.height = info.height
    if info.format:
        proto_meta.format = info.format
    if info.color_mode:
        proto_meta.color_mode = info.color_mode
    if info.duration_seconds is not None:
        proto_meta.duration_seconds = info.duration_seconds
    if info.page_count is not None:
        proto_meta.page_count = info.page_count
    if info.exif and isinstance(info.exif, dict):
        for key, value in info.exif.items():
            proto_meta.exif[str(key)] = str(value)
    if info.bitrate is not None:
        proto_meta.bitrate = info.bitrate
    if info.sample_rate is not None:
        proto_meta.sample_rate = info.sample_rate
    if info.channels is not None:
        proto_meta.channels = info.channels
    if info.extraction_error:
        proto_meta.error = info.extraction_error

    return proto_meta


def folder_to_proto(
    folder: Folder,
    effective_access_mode: AccessMode | None = None,
    effective_baseline_role: ContentRole | None = None,
) -> ProtoFolder:
    resolved_mode = (
        effective_access_mode if effective_access_mode is not None else folder.access_mode
    )
    resolved_baseline = (
        effective_baseline_role if effective_baseline_role is not None else folder.baseline_role
    )
    proto_folder = ProtoFolder(
        id=str(folder.id),
        urn=folder.urn,
        organization_id=str(folder.organization_id),
        owner_id=str(folder.owner_id),
        access_mode=access_mode_to_proto(resolved_mode) if resolved_mode is not None else 0,
        name=folder.name,
        is_deleted=folder.is_deleted,
        created_at=datetime_to_timestamp(folder.created_at),
        updated_at=datetime_to_timestamp(folder.updated_at),
        is_system=folder.is_system,
    )

    if resolved_baseline is not None:
        proto_folder.baseline_role = content_role_to_proto(resolved_baseline)

    if folder.parent_id:
        proto_folder.parent_id = str(folder.parent_id)

    return proto_folder


def file_version_to_proto(version: FileVersion) -> ProtoFileVersion:
    proto_version = ProtoFileVersion(
        id=str(version.id),
        file_id=str(version.file_id),
        version_number=version.version_number,
        size_bytes=version.size_bytes,
        uploaded_by=str(version.uploaded_by),
        created_at=datetime_to_timestamp(version.created_at),
    )

    if version.checksum_sha256:
        proto_version.checksum_sha256 = version.checksum_sha256

    return proto_version


def upload_to_proto_status(upload: MultipartUpload) -> ProtoUploadStatus:
    return UPLOAD_STATUS_TO_PROTO.get(
        upload.status,
        ProtoUploadStatus.UPLOAD_STATUS_ACTIVE,
    )


def tree_node_from_file(
    file: File,
    child_count: int = 0,
    effective_access_mode: AccessMode | None = None,
) -> ProtoTreeNode:
    resolved_mode = effective_access_mode if effective_access_mode is not None else file.access_mode
    node = ProtoTreeNode(
        id=str(file.id),
        name=file.filename,
        is_folder=False,
        access_mode=access_mode_to_proto(resolved_mode) if resolved_mode is not None else 0,
        child_count=0,
        size_bytes=file.size_bytes,
        mime_type=file.mime_type,
        owner_id=str(file.owner_id),
    )

    if file.folder_id:
        node.parent_id = str(file.folder_id)

    return node


def tree_node_from_folder(
    folder: Folder,
    child_count: int = 0,
    size_bytes: int | None = None,
    effective_access_mode: AccessMode | None = None,
    present_as_root: bool = False,
) -> ProtoTreeNode:
    resolved_mode = (
        effective_access_mode if effective_access_mode is not None else folder.access_mode
    )
    node = ProtoTreeNode(
        id=str(folder.id),
        name=folder.name,
        is_folder=True,
        access_mode=access_mode_to_proto(resolved_mode) if resolved_mode is not None else 0,
        child_count=child_count,
        owner_id=str(folder.owner_id),
    )

    # A shared folder whose real parent the viewer cannot see is presented as
    # a root: echoing the hidden parent id would both leak it and detach the
    # node from every parent-keyed frontend lookup.
    if folder.parent_id and not present_as_root:
        node.parent_id = str(folder.parent_id)

    if size_bytes is not None:
        node.size_bytes = size_bytes

    return node
