"""Proto <-> domain mapping for ``superadmin.v1.PlatformAuditService``."""

from __future__ import annotations

from datetime import datetime

from google.protobuf.timestamp_pb2 import Timestamp
from uniffy_proto.superadmin.v1.platform_audit_pb2 import (
    PlatformActionEntry,
    PlatformAuditEvent,
)

from uniffy.domains.platform.audit.operations import PlatformAuditView


def _to_timestamp(value: datetime | None) -> Timestamp | None:
    if value is None:
        return None
    ts = Timestamp()
    ts.FromDatetime(value)
    return ts


def event_to_proto(view: PlatformAuditView) -> PlatformAuditEvent:
    msg = PlatformAuditEvent(
        id=str(view.id),
        action=view.action,
        details_json=view.details_json,
    )
    created_at = _to_timestamp(view.created_at)
    if created_at is not None:
        msg.created_at.CopyFrom(created_at)
    if view.organization_id is not None:
        msg.organization_id = str(view.organization_id)
    if view.organization_name is not None:
        msg.organization_name = view.organization_name
    if view.actor_user_id is not None:
        msg.actor_user_id = str(view.actor_user_id)
    if view.actor_email is not None:
        msg.actor_email = view.actor_email
    if view.actor_org_role is not None:
        msg.actor_org_role = view.actor_org_role
    if view.resource_type is not None:
        msg.resource_type = view.resource_type
    if view.resource_id is not None:
        msg.resource_id = str(view.resource_id)
    if view.ip_address is not None:
        msg.ip_address = view.ip_address
    if view.user_agent is not None:
        msg.user_agent = view.user_agent
    return msg


def action_entry_to_proto(entry: tuple[str, str]) -> PlatformActionEntry:
    action, group = entry
    return PlatformActionEntry(action=action, group=group)
