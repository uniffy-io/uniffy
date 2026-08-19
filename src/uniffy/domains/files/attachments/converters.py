"""Proto converters for file attachments."""

from uniffy_proto.common.v1.common_pb2 import ContentType as ProtoContentType
from uniffy_proto.files.v1.files_pb2 import (
    AttachedFileOwner as ProtoAttachedFileOwner,
)
from uniffy_proto.files.v1.files_pb2 import (
    Attachment as ProtoAttachment,
)

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.models.files.attachment import Attachment
from uniffy.core.models.files.file import File
from uniffy.core.models.login.user import User
from uniffy.core.models.shared import ContentType

CONTENT_TYPE_TO_PROTO = {
    ContentType.NOTE: ProtoContentType.CONTENT_TYPE_NOTE,
    ContentType.FILE: ProtoContentType.CONTENT_TYPE_FILE,
    ContentType.CALENDAR_EVENT: ProtoContentType.CONTENT_TYPE_CALENDAR_EVENT,
    ContentType.CHAT_MESSAGE: ProtoContentType.CONTENT_TYPE_CHAT_MESSAGE,
    ContentType.PROJECT: ProtoContentType.CONTENT_TYPE_PROJECT,
    ContentType.TASK: ProtoContentType.CONTENT_TYPE_TASK,
}

CONTENT_TYPE_FROM_PROTO = {
    ProtoContentType.CONTENT_TYPE_NOTE: ContentType.NOTE,
    ProtoContentType.CONTENT_TYPE_FILE: ContentType.FILE,
    ProtoContentType.CONTENT_TYPE_CALENDAR_EVENT: ContentType.CALENDAR_EVENT,
    ProtoContentType.CONTENT_TYPE_CHAT_MESSAGE: ContentType.CHAT_MESSAGE,
    ProtoContentType.CONTENT_TYPE_PROJECT: ContentType.PROJECT,
    ProtoContentType.CONTENT_TYPE_TASK: ContentType.TASK,
}


def content_type_to_proto(content_type: ContentType) -> ProtoContentType:
    """Convert domain ContentType to proto enum."""
    return CONTENT_TYPE_TO_PROTO.get(content_type, ProtoContentType.CONTENT_TYPE_UNSPECIFIED)


def content_type_from_proto(proto_type: ProtoContentType) -> ContentType | None:
    """Convert proto ContentType to domain enum."""
    return CONTENT_TYPE_FROM_PROTO.get(proto_type)


def attachment_to_proto(
    attachment: Attachment,
    file: File,
    owner: User | None = None,
    include_source_file_id: bool = False,
) -> ProtoAttachment:
    """Convert an Attachment row plus its linked file into a proto message.

    ``source_file_id`` identifies the original the copy was made from, which the
    reader may have no access to, so it is emitted only when the caller has
    established that they do (default deny).
    """
    proto = ProtoAttachment(
        id=str(attachment.id),
        organization_id=str(attachment.organization_id),
        file_id=str(attachment.file_id),
        content_type=content_type_to_proto(attachment.content_type),
        content_id=str(attachment.content_id),
        attached_by_user_id=str(attachment.attached_by_user_id),
        attached_at=datetime_to_timestamp(attachment.attached_at),
        # File details
        filename=file.filename,
        mime_type=file.mime_type,
        size_bytes=file.size_bytes,
    )

    if attachment.source_file_id and include_source_file_id:
        proto.source_file_id = str(attachment.source_file_id)

    if owner:
        proto.owner_info.CopyFrom(
            ProtoAttachedFileOwner(
                id=str(owner.id),
                name=owner.full_name or owner.username or owner.email,
                email=owner.email,
            )
        )

    return proto
