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
from uniffy.core.models.files.file import ExtractionStatus, File
from uniffy.core.models.files.file_version import FileVersion
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.files.media_info import FileMediaInfo
from uniffy.core.models.files.multipart_upload import MultipartUpload, UploadStatus
from uniffy.core.types import ContentRole

# Extraction status mapping: model -> proto
EXTRACTION_STATUS_TO_PROTO = {
    ExtractionStatus.PENDING: ProtoExtractionStatus.EXTRACTION_STATUS_PENDING,
    ExtractionStatus.PROCESSING: ProtoExtractionStatus.EXTRACTION_STATUS_PROCESSING,
    ExtractionStatus.COMPLETED: ProtoExtractionStatus.EXTRACTION_STATUS_COMPLETED,
    ExtractionStatus.FAILED: ProtoExtractionStatus.EXTRACTION_STATUS_FAILED,
    ExtractionStatus.SKIPPED: ProtoExtractionStatus.EXTRACTION_STATUS_SKIPPED,
}

# Upload status mapping: model -> proto
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
) -> ProtoFile:
    """Convert :class:`File` to its proto representation.

    Parameters
    ----------
    file : File
        File model instance.
    user_role : ContentRole | None
        Effective role of the requesting user, if known.
    owner_info : dict | None
        Owner information (id, name, email) if file is shared with current user.
    group_ids : list[str] | None
        Group ids the file is explicitly shared with (for the legacy
        ``group_ids`` proto field).

    Returns
    -------
    ProtoFile
        Proto message.

    """
    proto_extraction = EXTRACTION_STATUS_TO_PROTO.get(
        file.extraction_status,
        ProtoExtractionStatus.EXTRACTION_STATUS_PENDING,
    )

    proto_file = ProtoFile(
        id=str(file.id),
        urn=file.urn,
        organization_id=str(file.organization_id),
        owner_id=str(file.owner_id),
        access_mode=access_mode_to_proto(file.access_mode),
        filename=file.filename,
        original_filename=file.original_filename,
        mime_type=file.mime_type,
        size_bytes=file.size_bytes,
        tags=file.tags or [],
        version=file.version,
        extraction_status=proto_extraction,
        is_deleted=file.is_deleted,
        created_at=datetime_to_timestamp(file.created_at),
        updated_at=datetime_to_timestamp(file.updated_at),
        group_ids=group_ids or [],
    )

    if file.baseline_role is not None:
        proto_file.baseline_role = content_role_to_proto(file.baseline_role)

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
    """Build :class:`ProtoFileMetadata` from a :class:`FileMediaInfo` row."""
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


def folder_to_proto(folder: Folder) -> ProtoFolder:
    """Convert :class:`Folder` to its proto representation."""
    proto_folder = ProtoFolder(
        id=str(folder.id),
        urn=folder.urn,
        organization_id=str(folder.organization_id),
        owner_id=str(folder.owner_id),
        access_mode=access_mode_to_proto(folder.access_mode),
        name=folder.name,
        is_deleted=folder.is_deleted,
        created_at=datetime_to_timestamp(folder.created_at),
        updated_at=datetime_to_timestamp(folder.updated_at),
        is_system=folder.is_system,
    )

    if folder.baseline_role is not None:
        proto_folder.baseline_role = content_role_to_proto(folder.baseline_role)

    if folder.parent_id:
        proto_folder.parent_id = str(folder.parent_id)

    return proto_folder


def file_version_to_proto(version: FileVersion) -> ProtoFileVersion:
    """Convert a :class:`FileVersion` to its proto representation."""
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
    """Convert upload status to proto."""
    return UPLOAD_STATUS_TO_PROTO.get(
        upload.status,
        ProtoUploadStatus.UPLOAD_STATUS_ACTIVE,
    )


def tree_node_from_file(file: File, child_count: int = 0) -> ProtoTreeNode:
    """Build a :class:`ProtoTreeNode` from a :class:`File` row."""
    node = ProtoTreeNode(
        id=str(file.id),
        name=file.filename,
        is_folder=False,
        access_mode=access_mode_to_proto(file.access_mode),
        child_count=0,
        size_bytes=file.size_bytes,
        mime_type=file.mime_type,
    )

    if file.folder_id:
        node.parent_id = str(file.folder_id)

    return node


def tree_node_from_folder(
    folder: Folder,
    child_count: int = 0,
    size_bytes: int | None = None,
) -> ProtoTreeNode:
    """Build a :class:`ProtoTreeNode` from a :class:`Folder` row."""
    node = ProtoTreeNode(
        id=str(folder.id),
        name=folder.name,
        is_folder=True,
        access_mode=access_mode_to_proto(folder.access_mode),
        child_count=child_count,
    )

    if folder.parent_id:
        node.parent_id = str(folder.parent_id)

    if size_bytes is not None:
        node.size_bytes = size_bytes

    return node
