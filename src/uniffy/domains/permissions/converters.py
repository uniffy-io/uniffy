"""Proto <-> domain converters for the permissions members service."""

from uuid import UUID

from uniffy_proto.permissions.v1.permissions_pb2 import (
    ContentAccessPolicy as ProtoContentAccessPolicy,
)
from uniffy_proto.permissions.v1.permissions_pb2 import (
    ContentMember as ProtoContentMember,
)
from uniffy_proto.permissions.v1.permissions_pb2 import (
    ContentMemberEvent as ProtoContentMemberEvent,
)

from uniffy.core.audit.actions import Action
from uniffy.core.converters.common_proto import (
    access_mode_to_proto,
    content_member_action_to_proto,
    content_role_to_proto,
    content_type_to_proto,
    subject_type_to_proto,
)
from uniffy.core.converters.proto import (
    datetime_to_timestamp,
    optional_timestamp,
)
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.types import (
    AccessMode,
    ContentMemberAction,
    ContentRole,
    ContentType,
    SubjectType,
)

_ACTION_FROM_AUDIT: dict[str, ContentMemberAction] = {
    Action.PERMISSIONS_MEMBER_ADDED: ContentMemberAction.MEMBER_ADDED,
    Action.PERMISSIONS_MEMBER_ROLE_CHANGED: ContentMemberAction.MEMBER_ROLE_CHANGED,
    Action.PERMISSIONS_MEMBER_REMOVED: ContentMemberAction.MEMBER_REMOVED,
    Action.PERMISSIONS_ACCESS_MODE_CHANGED: ContentMemberAction.ACCESS_MODE_CHANGED,
    Action.PERMISSIONS_BASELINE_ROLE_CHANGED: ContentMemberAction.BASELINE_ROLE_CHANGED,
    Action.PERMISSIONS_OWNERSHIP_TRANSFERRED: ContentMemberAction.OWNERSHIP_TRANSFERRED,
}

_ACTION_TO_AUDIT: dict[ContentMemberAction, str] = {
    domain: audit for audit, domain in _ACTION_FROM_AUDIT.items()
}


def audit_action_for_member_action(action: ContentMemberAction) -> str:
    return _ACTION_TO_AUDIT[action]


def content_member_to_proto(member: ContentMember) -> ProtoContentMember:
    proto = ProtoContentMember(
        subject_type=subject_type_to_proto(member.subject_type),
        subject_id=str(member.subject_id),
        role=content_role_to_proto(member.role),
        added_by_user_id=str(member.added_by_user_id),
        added_at=datetime_to_timestamp(member.added_at),
        updated_at=datetime_to_timestamp(member.updated_at),
    )
    expires_ts = optional_timestamp(member.expires_at)
    if expires_ts is not None:
        proto.expires_at.CopyFrom(expires_ts)
    return proto


def content_access_policy_to_proto(
    owner_id: UUID,
    access_mode: AccessMode | None,
    baseline_role: ContentRole | None,
    caller_role: ContentRole | None = None,
) -> ProtoContentAccessPolicy:
    """``access_mode=None`` means the row inherits from org defaults;
    emitted as ``ACCESS_MODE_UNSPECIFIED``. ``caller_role=None`` means the
    requesting user has no access; the field is left unset.
    """
    proto = ProtoContentAccessPolicy(
        owner_id=str(owner_id),
        access_mode=access_mode_to_proto(access_mode) if access_mode is not None else 0,
    )
    if baseline_role is not None:
        proto.baseline_role = content_role_to_proto(baseline_role)
    if caller_role is not None:
        proto.caller_role = content_role_to_proto(caller_role)
    return proto


def audit_event_to_content_member_event_proto(
    event: AuditEvent,
) -> ProtoContentMemberEvent:
    """Unknown actions raise ``KeyError``; callers filter to ``permissions.*`` upstream."""
    member_action = _ACTION_FROM_AUDIT[event.action]
    details = event.details or {}

    proto = ProtoContentMemberEvent(
        id=str(event.id),
        content_type=content_type_to_proto(ContentType(event.resource_type)),
        content_id=str(event.resource_id) if event.resource_id else "",
        action=content_member_action_to_proto(member_action),
        actor_user_id=str(event.actor_user_id) if event.actor_user_id else "",
        note=str(details.get("note") or ""),
        occurred_at=datetime_to_timestamp(event.created_at),
    )

    if event.actor_org_role:
        from uniffy.core.converters.common_proto import org_role_to_proto
        from uniffy.core.models.login.organization_member import OrganizationRole

        proto.actor_org_role = org_role_to_proto(OrganizationRole(event.actor_org_role))

    subject_type_raw = details.get("subject_type")
    if subject_type_raw:
        proto.subject_type = subject_type_to_proto(SubjectType(subject_type_raw))
    subject_id_raw = details.get("subject_id")
    if subject_id_raw:
        proto.subject_id = str(subject_id_raw)

    previous_role_raw = details.get("previous_role")
    if previous_role_raw:
        proto.previous_role = content_role_to_proto(ContentRole(previous_role_raw))
    new_role_raw = details.get("new_role")
    if new_role_raw:
        proto.new_role = content_role_to_proto(ContentRole(new_role_raw))

    previous_access_mode_raw = details.get("previous_access_mode")
    if previous_access_mode_raw:
        proto.previous_access_mode = access_mode_to_proto(
            AccessMode(previous_access_mode_raw)
        )
    new_access_mode_raw = details.get("new_access_mode")
    if new_access_mode_raw:
        proto.new_access_mode = access_mode_to_proto(AccessMode(new_access_mode_raw))

    previous_baseline_role_raw = details.get("previous_baseline_role")
    if previous_baseline_role_raw:
        proto.previous_baseline_role = content_role_to_proto(
            ContentRole(previous_baseline_role_raw)
        )
    new_baseline_role_raw = details.get("new_baseline_role")
    if new_baseline_role_raw:
        proto.new_baseline_role = content_role_to_proto(
            ContentRole(new_baseline_role_raw)
        )

    previous_owner_id_raw = details.get("previous_owner_id")
    if previous_owner_id_raw:
        proto.previous_owner_id = str(previous_owner_id_raw)
    new_owner_id_raw = details.get("new_owner_id")
    if new_owner_id_raw:
        proto.new_owner_id = str(new_owner_id_raw)

    return proto
