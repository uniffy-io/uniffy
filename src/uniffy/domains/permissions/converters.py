"""Proto <-> domain converters for permissions domain."""

from uniffy.core.converters import datetime_to_timestamp, optional_timestamp
from uniffy.core.models import ContentPermission, Group, User
from uniffy.core.models.shared import ContentType as DomainContentType
from uniffy.core.models.shared import PermissionLevel as DomainPermissionLevel
from uniffy.core.models.shared import SubjectType as DomainSubjectType
from uniffy.gen.common.v1.common_pb2 import (
    ContentType as ProtoContentType,
)
from uniffy.gen.common.v1.common_pb2 import (
    PermissionLevel,
)
from uniffy.gen.common.v1.common_pb2 import (
    SubjectType as ProtoSubjectType,
)
from uniffy.gen.permissions.v1.permissions_pb2 import (
    PermissionInfo,
    ShareTarget,
)

# Domain ContentType to Proto ContentType mapping
DOMAIN_CONTENT_TYPE_TO_PROTO: dict[DomainContentType, ProtoContentType] = {
    DomainContentType.NOTE: ProtoContentType.CONTENT_TYPE_NOTE,
    DomainContentType.FILE: ProtoContentType.CONTENT_TYPE_FILE,
    DomainContentType.CALENDAR_EVENT: ProtoContentType.CONTENT_TYPE_CALENDAR_EVENT,
    DomainContentType.CHAT_MESSAGE: ProtoContentType.CONTENT_TYPE_CHAT_MESSAGE,
    DomainContentType.USER: ProtoContentType.CONTENT_TYPE_USER,
    DomainContentType.PROJECT: ProtoContentType.CONTENT_TYPE_PROJECT,
    DomainContentType.TASK: ProtoContentType.CONTENT_TYPE_TASK,
    DomainContentType.AGENT: ProtoContentType.CONTENT_TYPE_AGENT,
    DomainContentType.PROVIDER_KEY: ProtoContentType.CONTENT_TYPE_PROVIDER_KEY,
    DomainContentType.PROMPT: ProtoContentType.CONTENT_TYPE_PROMPT,
}

# Proto ContentType to Domain ContentType mapping
PROTO_CONTENT_TYPE_TO_DOMAIN: dict[ProtoContentType, DomainContentType] = {
    v: k for k, v in DOMAIN_CONTENT_TYPE_TO_PROTO.items()
}

# Domain SubjectType to Proto SubjectType mapping
DOMAIN_SUBJECT_TYPE_TO_PROTO: dict[DomainSubjectType, ProtoSubjectType] = {
    DomainSubjectType.USER: ProtoSubjectType.SUBJECT_TYPE_USER,
    DomainSubjectType.GROUP: ProtoSubjectType.SUBJECT_TYPE_GROUP,
}

# Proto SubjectType to Domain SubjectType mapping
PROTO_SUBJECT_TYPE_TO_DOMAIN: dict[ProtoSubjectType, DomainSubjectType] = {
    v: k for k, v in DOMAIN_SUBJECT_TYPE_TO_PROTO.items()
}

# Domain PermissionLevel to Proto PermissionLevel mapping
DOMAIN_PERMISSION_LEVEL_TO_PROTO: dict[DomainPermissionLevel, PermissionLevel] = {
    DomainPermissionLevel.VIEW: PermissionLevel.PERMISSION_LEVEL_VIEW,
    DomainPermissionLevel.EDIT: PermissionLevel.PERMISSION_LEVEL_EDIT,
    DomainPermissionLevel.ADMIN: PermissionLevel.PERMISSION_LEVEL_ADMIN,
    # Map OWNER to ADMIN for proto (no proto equivalent)
    DomainPermissionLevel.OWNER: PermissionLevel.PERMISSION_LEVEL_ADMIN,
}

# Proto PermissionLevel to Domain PermissionLevel mapping
PROTO_PERMISSION_LEVEL_TO_DOMAIN: dict[PermissionLevel, DomainPermissionLevel] = {
    PermissionLevel.PERMISSION_LEVEL_VIEW: DomainPermissionLevel.VIEW,
    PermissionLevel.PERMISSION_LEVEL_EDIT: DomainPermissionLevel.EDIT,
    PermissionLevel.PERMISSION_LEVEL_ADMIN: DomainPermissionLevel.ADMIN,
}


def content_type_to_proto(content_type: DomainContentType) -> ProtoContentType:
    """Convert domain ContentType to proto ContentType."""
    return DOMAIN_CONTENT_TYPE_TO_PROTO.get(content_type, ProtoContentType.CONTENT_TYPE_UNSPECIFIED)


def proto_to_content_type(proto_type: ProtoContentType) -> DomainContentType | None:
    """Convert proto ContentType to domain ContentType."""
    return PROTO_CONTENT_TYPE_TO_DOMAIN.get(proto_type)


def subject_type_to_proto(subject_type: DomainSubjectType) -> ProtoSubjectType:
    """Convert domain SubjectType to proto SubjectType."""
    return DOMAIN_SUBJECT_TYPE_TO_PROTO.get(subject_type, ProtoSubjectType.SUBJECT_TYPE_UNSPECIFIED)


def proto_to_subject_type(proto_type: ProtoSubjectType) -> DomainSubjectType | None:
    """Convert proto SubjectType to domain SubjectType."""
    return PROTO_SUBJECT_TYPE_TO_DOMAIN.get(proto_type)


def permission_level_to_proto(level: DomainPermissionLevel) -> PermissionLevel:
    """Convert domain PermissionLevel to proto PermissionLevel."""
    return DOMAIN_PERMISSION_LEVEL_TO_PROTO.get(level, PermissionLevel.PERMISSION_LEVEL_VIEW)


def proto_to_permission_level(proto_level: PermissionLevel) -> DomainPermissionLevel:
    """Convert proto PermissionLevel to domain PermissionLevel."""
    return PROTO_PERMISSION_LEVEL_TO_DOMAIN.get(proto_level, DomainPermissionLevel.VIEW)


def user_to_share_target(user: User) -> ShareTarget:
    """Convert User model to ShareTarget proto."""
    return ShareTarget(
        id=str(user.id),
        type=ProtoSubjectType.SUBJECT_TYPE_USER,
        name=user.full_name or user.email,
        email=user.email,
    )


def group_to_share_target(group: Group, member_count: int = 0) -> ShareTarget:
    """Convert Group model to ShareTarget proto."""
    return ShareTarget(
        id=str(group.id),
        type=ProtoSubjectType.SUBJECT_TYPE_GROUP,
        name=group.name,
        member_count=member_count,
    )


def permission_to_proto(
    permission: ContentPermission,
    subject: User | Group | None = None,
    granted_by: User | None = None,
    member_count: int = 0,
    is_owner: bool = False,
) -> PermissionInfo:
    """
    Convert ContentPermission model to PermissionInfo proto.

    Parameters
    ----------
    permission : ContentPermission
        Permission model instance.
    subject : User | Group | None
        The user or group that has the permission.
    granted_by : User | None
        The user who granted the permission.
    member_count : int
        Member count for group subjects.
    is_owner : bool
        Whether the subject is the actual content owner.

    Returns
    -------
    PermissionInfo
        Proto message.

    """
    info = PermissionInfo(
        id=str(permission.id),
        content_type=content_type_to_proto(permission.content_type),
        content_id=str(permission.content_id),
        subject_type=subject_type_to_proto(permission.subject_type),
        level=permission_level_to_proto(permission.permission_level),
        can_view=permission.can_view,
        can_edit=permission.can_edit,
        can_delete=permission.can_delete,
        can_share=permission.can_share,
        can_move=permission.can_move,
        granted_at=datetime_to_timestamp(permission.granted_at),
        is_owner=is_owner,
    )

    # Set subject
    if subject:
        if isinstance(subject, User):
            info.subject.CopyFrom(user_to_share_target(subject))
        else:
            info.subject.CopyFrom(group_to_share_target(subject, member_count))

    # Set granted_by
    if granted_by:
        info.granted_by.CopyFrom(user_to_share_target(granted_by))

    # Set expiration if present
    expires_ts = optional_timestamp(permission.expires_at)
    if expires_ts:
        info.expires_at.CopyFrom(expires_ts)

    return info


def get_permission_flags_from_level(level: PermissionLevel) -> dict[str, bool]:
    """
    Get permission flags based on permission level.

    Parameters
    ----------
    level : PermissionLevel
        The permission level.

    Returns
    -------
    dict[str, bool]
        Dictionary of permission flags.

    """
    if level == PermissionLevel.PERMISSION_LEVEL_VIEW:
        return {
            "can_view": True,
            "can_edit": False,
            "can_delete": False,
            "can_share": False,
            "can_move": False,
        }
    elif level == PermissionLevel.PERMISSION_LEVEL_EDIT:
        return {
            "can_view": True,
            "can_edit": True,
            "can_delete": False,
            "can_share": False,
            "can_move": False,
        }
    elif level == PermissionLevel.PERMISSION_LEVEL_ADMIN:
        return {
            "can_view": True,
            "can_edit": True,
            "can_delete": True,
            "can_share": True,
            "can_move": True,
        }
    else:
        return {
            "can_view": True,
            "can_edit": False,
            "can_delete": False,
            "can_share": False,
            "can_move": False,
        }
