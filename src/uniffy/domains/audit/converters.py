"""Proto <-> domain converters for ``audit.v1``."""

from uniffy_proto.audit.v1.audit_pb import AuditEvent as ProtoAuditEvent

from uniffy.core.converters.proto import datetime_to_timestamp
from uniffy.core.json_codec import dumps_str
from uniffy.core.models.audit.event import AuditEvent


def audit_event_to_proto(event: AuditEvent) -> ProtoAuditEvent:
    """Convert an ``AuditEvent`` row to its proto representation."""
    proto = ProtoAuditEvent(
        id=str(event.id),
        organization_id=str(event.organization_id),
        action=event.action,
        details_json=dumps_str(event.details or {}),
        created_at=datetime_to_timestamp(event.created_at),
    )
    if event.actor_user_id is not None:
        proto.actor_user_id = str(event.actor_user_id)
    if event.actor_org_role is not None:
        proto.actor_org_role = event.actor_org_role
    if event.on_behalf_of_user_id is not None:
        proto.on_behalf_of_user_id = str(event.on_behalf_of_user_id)
    if event.resource_type is not None:
        proto.resource_type = event.resource_type
    if event.resource_id is not None:
        proto.resource_id = str(event.resource_id)
    if event.ip_address is not None:
        proto.ip_address = str(event.ip_address)
    if event.user_agent is not None:
        proto.user_agent = event.user_agent
    return proto
