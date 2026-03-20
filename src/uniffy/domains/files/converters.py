"""Proto <-> domain converters for files domain."""

from uniffy_proto.common.v1.common_pb2 import VisibilityScope as ProtoVisibilityScope
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
from uniffy.core.models.files.file import ExtractionStatus, File
from uniffy.core.models.files.file_version import FileVersion
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.files.media_info import FileMediaInfo
from uniffy.core.models.files.multipart_upload import MultipartUpload, UploadStatus
from uniffy.core.models.shared import VisibilityScope

# Visibility mapping: model -> proto
VISIBILITY_TO_PROTO = {
    VisibilityScope.PRIVATE: ProtoVisibilityScope.VISIBILITY_SCOPE_PRIVATE,
    VisibilityScope.GROUP: ProtoVisibilityScope.VISIBILITY_SCOPE_GROUP,
    VisibilityScope.ORGANIZATION: ProtoVisibilityScope.VISIBILITY_SCOPE_ORGANIZATION,
    VisibilityScope.PUBLIC: ProtoVisibilityScope.VISIBILITY_SCOPE_PUBLIC,
}

# Visibility mapping: proto -> model
VISIBILITY_FROM_PROTO = {
    ProtoVisibilityScope.VISIBILITY_SCOPE_UNSPECIFIED: VisibilityScope.PRIVATE,
    ProtoVisibilityScope.VISIBILITY_SCOPE_PRIVATE: VisibilityScope.PRIVATE,
    ProtoVisibilityScope.VISIBILITY_SCOPE_GROUP: VisibilityScope.GROUP,
    ProtoVisibilityScope.VISIBILITY_SCOPE_ORGANIZATION: VisibilityScope.ORGANIZATION,
    ProtoVisibilityScope.VISIBILITY_SCOPE_PUBLIC: VisibilityScope.PUBLIC,
}

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
    owner_info: dict | None = None,
    group_ids: list[str] | None = None,
) -> ProtoFile:
    """
    Convert File model to proto File.

    Parameters
    ----------
    file : File
        File model instance.
    owner_info : dict | None
        Owner information (id, name, email) if file is shared with current user.
    group_ids : list[str] | None
        Group IDs if file is shared with groups.

    Returns
    -------
    ProtoFile
        Proto message.

    """
    proto_visibility = VISIBILITY_TO_PROTO.get(
        file.visibility,
        ProtoVisibilityScope.VISIBILITY_SCOPE_PRIVATE,
    )
    proto_extraction = EXTRACTION_STATUS_TO_PROTO.get(
        file.extraction_status,
        ProtoExtractionStatus.EXTRACTION_STATUS_PENDING,
    )

    proto_file = ProtoFile(
        id=str(file.id),
        urn=file.urn,
        organization_id=str(file.organization_id),
        owner_id=str(file.owner_id),
        visibility=proto_visibility,
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

    # Build metadata from FileMediaInfo relationship
    if file.media_info:
        proto_file.metadata.CopyFrom(_build_file_metadata_from_model(file.media_info))

    return proto_file


def _build_file_metadata_from_model(info: FileMediaInfo) -> ProtoFileMetadata:
    """
    Build FileMetadata proto from a FileMediaInfo model instance.

    Parameters
    ----------
    info : FileMediaInfo
        The FileMediaInfo model.

    Returns
    -------
    ProtoFileMetadata
        Proto message with extracted metadata.

    """
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
    """
    Convert Folder model to proto Folder.

    Parameters
    ----------
    folder : Folder
        Folder model instance.

    Returns
    -------
    ProtoFolder
        Proto message.

    """
    proto_visibility = VISIBILITY_TO_PROTO.get(
        folder.visibility,
        ProtoVisibilityScope.VISIBILITY_SCOPE_PRIVATE,
    )

    proto_folder = ProtoFolder(
        id=str(folder.id),
        urn=folder.urn,
        organization_id=str(folder.organization_id),
        owner_id=str(folder.owner_id),
        visibility=proto_visibility,
        name=folder.name,
        is_deleted=folder.is_deleted,
        created_at=datetime_to_timestamp(folder.created_at),
        updated_at=datetime_to_timestamp(folder.updated_at),
        is_system=folder.is_system,
    )

    if folder.parent_id:
        proto_folder.parent_id = str(folder.parent_id)

    return proto_folder


def file_version_to_proto(version: FileVersion) -> ProtoFileVersion:
    """
    Convert FileVersion model to proto FileVersion.

    Parameters
    ----------
    version : FileVersion
        FileVersion model instance.

    Returns
    -------
    ProtoFileVersion
        Proto message.

    """
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
    """
    Create a TreeNode proto from a File model.

    Parameters
    ----------
    file : File
        File model instance.
    child_count : int
        Number of child items (always 0 for files).

    Returns
    -------
    ProtoTreeNode
        Proto tree node.

    """
    proto_visibility = VISIBILITY_TO_PROTO.get(
        file.visibility,
        ProtoVisibilityScope.VISIBILITY_SCOPE_PRIVATE,
    )

    node = ProtoTreeNode(
        id=str(file.id),
        name=file.filename,
        is_folder=False,
        visibility=proto_visibility,
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
    """
    Create a TreeNode proto from a Folder model.

    Parameters
    ----------
    folder : Folder
        Folder model instance.
    child_count : int
        Number of child items in the folder.
    size_bytes : int | None
        Total size of all files in the folder (recursively).

    Returns
    -------
    ProtoTreeNode
        Proto tree node.

    """
    proto_visibility = VISIBILITY_TO_PROTO.get(
        folder.visibility,
        ProtoVisibilityScope.VISIBILITY_SCOPE_PRIVATE,
    )

    node = ProtoTreeNode(
        id=str(folder.id),
        name=folder.name,
        is_folder=True,
        visibility=proto_visibility,
        child_count=child_count,
    )

    if folder.parent_id:
        node.parent_id = str(folder.parent_id)

    if size_bytes is not None:
        node.size_bytes = size_bytes

    return node


def visibility_from_proto(proto_visibility: ProtoVisibilityScope) -> VisibilityScope:
    """
    Convert proto VisibilityScope to model.

    Parameters
    ----------
    proto_visibility : ProtoVisibilityScope
        Proto visibility enum.

    Returns
    -------
    VisibilityScope
        Model visibility enum.

    """
    return VISIBILITY_FROM_PROTO.get(proto_visibility, VisibilityScope.PRIVATE)
