"""Proto <-> domain converters for the permissions members service."""

from uuid import UUID

from uniffy_proto.permissions.v1.permissions_pb2 import (
    ACCESS_REQUEST_STATE_APPROVED,
    ACCESS_REQUEST_STATE_CANCELED,
    ACCESS_REQUEST_STATE_DENIED,
    ACCESS_REQUEST_STATE_PENDING,
    ACCESS_REQUEST_STATE_UNSPECIFIED,
    REQUEST_ACCESS_OUTCOME_ALREADY_ACCESSIBLE,
    REQUEST_ACCESS_OUTCOME_ALREADY_PENDING,
    REQUEST_ACCESS_OUTCOME_COOLDOWN,
    REQUEST_ACCESS_OUTCOME_CREATED,
    AccessRequestStatus,
)
from uniffy_proto.permissions.v1.permissions_pb2 import (
    ContentAccessPolicy as ProtoContentAccessPolicy,
)
from uniffy_proto.permissions.v1.permissions_pb2 import (
    ContentAccessRequest as ProtoContentAccessRequest,
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
from uniffy.core.models.permissions.content_access_request import ContentAccessRequestState
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.types import (
    AccessMode,
    ContentMemberAction,
    ContentRole,
    ContentType,
    SubjectType,
)
from uniffy.domains.permissions.access_requests import (
    AccessRequestStatusView,
    AccessRequestView,
    RequestAccessOutcome,
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

_ACCESS_REQUEST_STATE_TO_PROTO = {
    ContentAccessRequestState.PENDING: ACCESS_REQUEST_STATE_PENDING,
    ContentAccessRequestState.APPROVED: ACCESS_REQUEST_STATE_APPROVED,
    ContentAccessRequestState.DENIED: ACCESS_REQUEST_STATE_DENIED,
    ContentAccessRequestState.CANCELED: ACCESS_REQUEST_STATE_CANCELED,
}

_REQUEST_ACCESS_OUTCOME_TO_PROTO = {
    RequestAccessOutcome.CREATED: REQUEST_ACCESS_OUTCOME_CREATED,
    RequestAccessOutcome.ALREADY_PENDING: REQUEST_ACCESS_OUTCOME_ALREADY_PENDING,
    RequestAccessOutcome.ALREADY_ACCESSIBLE: REQUEST_ACCESS_OUTCOME_ALREADY_ACCESSIBLE,
    RequestAccessOutcome.COOLDOWN: REQUEST_ACCESS_OUTCOME_COOLDOWN,
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


def access_request_outcome_to_proto(outcome: RequestAccessOutcome) -> int:
    return _REQUEST_ACCESS_OUTCOME_TO_PROTO[outcome]


def access_request_view_to_proto(view: AccessRequestView) -> ProtoContentAccessRequest:
    request = view.request
    proto = ProtoContentAccessRequest(
        id=str(request.id),
        organization_id=str(request.organization_id),
        requested_urn=request.requested_urn,
        original_content_type=content_type_to_proto(request.original_content_type),
        original_content_id=str(request.original_content_id),
        canonical_content_type=content_type_to_proto(request.canonical_content_type),
        canonical_content_id=str(request.canonical_content_id),
        requester_id=str(request.requester_id),
        requester_display_name=view.requester_display_name,
        state=_ACCESS_REQUEST_STATE_TO_PROTO[request.state],
        message=request.message,
        decision_note=request.decision_note,
        created_at=datetime_to_timestamp(request.created_at),
        updated_at=datetime_to_timestamp(request.updated_at),
        requester_has_access=view.requester_has_access,
    )
    if request.approved_role is not None:
        proto.approved_role = content_role_to_proto(request.approved_role)
    if request.responded_by_user_id is not None:
        proto.responded_by_user_id = str(request.responded_by_user_id)
    responded_at = optional_timestamp(request.responded_at)
    if responded_at is not None:
        proto.responded_at.CopyFrom(responded_at)
    can_request_again_at = optional_timestamp(view.can_request_again_at)
    if can_request_again_at is not None:
        proto.can_request_again_at.CopyFrom(can_request_again_at)
    return proto


def access_request_status_to_proto(view: AccessRequestStatusView) -> AccessRequestStatus:
    proto = AccessRequestStatus(
        requested_urn=view.requested_urn,
        state=(
            _ACCESS_REQUEST_STATE_TO_PROTO[view.state]
            if view.state is not None
            else ACCESS_REQUEST_STATE_UNSPECIFIED
        ),
        requester_has_access=view.requester_has_access,
    )
    if view.request_id is not None:
        proto.request_id = str(view.request_id)
    can_request_again_at = optional_timestamp(view.can_request_again_at)
    if can_request_again_at is not None:
        proto.can_request_again_at.CopyFrom(can_request_again_at)
    return proto


def content_access_policy_to_proto(
    owner_id: UUID,
    access_mode: AccessMode | None,
    baseline_role: ContentRole | None,
    caller_role: ContentRole | None = None,
    effective_access_mode: AccessMode | None = None,
) -> ProtoContentAccessPolicy:
    """``access_mode=None`` means the row inherits from org defaults;
    emitted as ``ACCESS_MODE_UNSPECIFIED``. ``caller_role=None`` means the
    requesting user has no access; the field is left unset.
    ``effective_access_mode`` is the resolved mode after inheritance.
    """
    proto = ProtoContentAccessPolicy(
        owner_id=str(owner_id),
        access_mode=access_mode_to_proto(access_mode) if access_mode is not None else 0,
    )
    if baseline_role is not None:
        proto.baseline_role = content_role_to_proto(baseline_role)
    if caller_role is not None:
        proto.caller_role = content_role_to_proto(caller_role)
    if effective_access_mode is not None:
        proto.effective_access_mode = access_mode_to_proto(effective_access_mode)
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
        proto.previous_access_mode = access_mode_to_proto(AccessMode(previous_access_mode_raw))
    new_access_mode_raw = details.get("new_access_mode")
    if new_access_mode_raw:
        proto.new_access_mode = access_mode_to_proto(AccessMode(new_access_mode_raw))

    previous_baseline_role_raw = details.get("previous_baseline_role")
    if previous_baseline_role_raw:
        proto.previous_baseline_role = content_role_to_proto(ContentRole(previous_baseline_role_raw))
    new_baseline_role_raw = details.get("new_baseline_role")
    if new_baseline_role_raw:
        proto.new_baseline_role = content_role_to_proto(ContentRole(new_baseline_role_raw))

    previous_owner_id_raw = details.get("previous_owner_id")
    if previous_owner_id_raw:
        proto.previous_owner_id = str(previous_owner_id_raw)
    new_owner_id_raw = details.get("new_owner_id")
    if new_owner_id_raw:
        proto.new_owner_id = str(new_owner_id_raw)

    return proto
