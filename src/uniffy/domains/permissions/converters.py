"""Proto <-> domain converters for the permissions members service.

Wraps the canonical enum converters in ``core.converters.common_proto``
with message-level converters for ``ContentMember``,
``ContentMemberEvent``, and ``ContentAccessPolicy``.
"""

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

from uniffy.core.converters.common_proto import (
    access_mode_to_proto,
    content_member_action_to_proto,
    content_role_to_proto,
    content_type_to_proto,
    org_role_to_proto,
    subject_type_to_proto,
)
from uniffy.core.converters.proto import (
    datetime_to_timestamp,
    optional_timestamp,
)
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.permissions.content_member_event import ContentMemberEvent
from uniffy.core.types import AccessMode, ContentRole


def content_member_to_proto(member: ContentMember) -> ProtoContentMember:
    """Convert a ``ContentMember`` row to its proto representation."""
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
    access_mode: AccessMode,
    baseline_role: ContentRole | None,
) -> ProtoContentAccessPolicy:
    """Build a ``ContentAccessPolicy`` proto from raw access policy fields."""
    proto = ProtoContentAccessPolicy(
        owner_id=str(owner_id),
        access_mode=access_mode_to_proto(access_mode),
    )
    if baseline_role is not None:
        proto.baseline_role = content_role_to_proto(baseline_role)
    return proto


def content_member_event_to_proto(
    event: ContentMemberEvent,
) -> ProtoContentMemberEvent:
    """Convert a ``ContentMemberEvent`` audit row to its proto."""
    proto = ProtoContentMemberEvent(
        id=str(event.id),
        content_type=content_type_to_proto(event.content_type),
        content_id=str(event.content_id),
        action=content_member_action_to_proto(event.action),
        actor_user_id=str(event.actor_user_id),
        actor_org_role=org_role_to_proto(event.actor_org_role),
        note=event.note,
        occurred_at=datetime_to_timestamp(event.occurred_at),
    )

    if event.subject_type is not None:
        proto.subject_type = subject_type_to_proto(event.subject_type)
    if event.subject_id is not None:
        proto.subject_id = str(event.subject_id)

    if event.previous_role is not None:
        proto.previous_role = content_role_to_proto(event.previous_role)
    if event.new_role is not None:
        proto.new_role = content_role_to_proto(event.new_role)

    if event.previous_access_mode is not None:
        proto.previous_access_mode = access_mode_to_proto(event.previous_access_mode)
    if event.new_access_mode is not None:
        proto.new_access_mode = access_mode_to_proto(event.new_access_mode)

    if event.previous_baseline_role is not None:
        proto.previous_baseline_role = content_role_to_proto(event.previous_baseline_role)
    if event.new_baseline_role is not None:
        proto.new_baseline_role = content_role_to_proto(event.new_baseline_role)

    if event.previous_owner_id is not None:
        proto.previous_owner_id = str(event.previous_owner_id)
    if event.new_owner_id is not None:
        proto.new_owner_id = str(event.new_owner_id)

    return proto
