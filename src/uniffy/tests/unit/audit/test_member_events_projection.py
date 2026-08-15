"""Projection of ``audit_events`` rows into the ``ContentMemberEvent`` proto.

The wire contract for ``permissions.v1.MembersService.ListMemberEvents``
expects ``ContentMemberEvent`` rows; the storage backing it is
``audit_events`` filtered to ``action LIKE 'permissions.%'``. This test
guards the converter so a future detail-payload tweak cannot silently
change the proto output.
"""

from datetime import UTC, datetime
from uuid import UUID

from uniffy_proto.common.v1.common_pb2 import (
    ContentMemberAction as ProtoContentMemberAction,
)
from uniffy_proto.common.v1.common_pb2 import ContentRole as ProtoContentRole
from uniffy_proto.common.v1.common_pb2 import ContentType as ProtoContentType
from uniffy_proto.common.v1.common_pb2 import SubjectType as ProtoSubjectType

from uniffy.core.audit.actions import Action
from uniffy.core.models.audit.event import AuditEvent
from uniffy.domains.permissions.converters import (
    audit_action_for_member_action,
    audit_event_to_content_member_event_proto,
)


def _event(action: str, details: dict) -> AuditEvent:
    return AuditEvent(
        id=UUID("018f0000-0000-7000-8000-000000000001"),
        organization_id=UUID("018f0000-0000-7000-8000-000000000010"),
        actor_user_id=UUID("018f0000-0000-7000-8000-000000000020"),
        actor_org_role="ADMIN",
        action=action,
        resource_type="NOTE",
        resource_id=UUID("018f0000-0000-7000-8000-000000000030"),
        details=details,
        created_at=datetime(2026, 5, 20, 9, 0, 0, tzinfo=UTC),
    )


def test_member_added_projection() -> None:
    event = _event(
        Action.PERMISSIONS_MEMBER_ADDED,
        {
            "subject_type": "USER",
            "subject_id": "018f0000-0000-7000-8000-000000000040",
            "new_role": "EDITOR",
            "note": "from picker",
        },
    )

    proto = audit_event_to_content_member_event_proto(event)

    assert proto.action == ProtoContentMemberAction.CONTENT_MEMBER_ACTION_MEMBER_ADDED
    assert proto.content_type == ProtoContentType.CONTENT_TYPE_NOTE
    assert proto.subject_type == ProtoSubjectType.SUBJECT_TYPE_USER
    assert proto.subject_id == "018f0000-0000-7000-8000-000000000040"
    assert proto.new_role == ProtoContentRole.CONTENT_ROLE_EDITOR
    assert proto.note == "from picker"


def test_ownership_transferred_projection() -> None:
    new_owner = "018f0000-0000-7000-8000-000000000050"
    previous_owner = "018f0000-0000-7000-8000-000000000060"
    event = _event(
        Action.PERMISSIONS_OWNERSHIP_TRANSFERRED,
        {
            "subject_type": "USER",
            "subject_id": new_owner,
            "previous_owner_id": previous_owner,
            "new_owner_id": new_owner,
            "note": "",
        },
    )

    proto = audit_event_to_content_member_event_proto(event)

    assert proto.action == ProtoContentMemberAction.CONTENT_MEMBER_ACTION_OWNERSHIP_TRANSFERRED
    assert proto.previous_owner_id == previous_owner
    assert proto.new_owner_id == new_owner
    assert proto.subject_id == new_owner


def test_audit_action_for_member_action_round_trips() -> None:
    from uniffy.core.types import ContentMemberAction

    for action in ContentMemberAction:
        audit_action = audit_action_for_member_action(action)
        assert audit_action.startswith("permissions.")
