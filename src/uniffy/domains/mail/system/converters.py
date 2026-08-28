"""Proto <-> domain mapping for ``superadmin.v1.SystemMailService``.

Mirrors the secret-redaction contract of ``mail/converters.py``:
secret presence is surfaced via ``*_set`` booleans, plaintext never
appears on a response message.
"""

from __future__ import annotations

from datetime import datetime

from google.protobuf.timestamp_pb2 import Timestamp
from uniffy_proto.superadmin.v1.system_mail_pb2 import (
    GlobalDeliveryEntry,
    GlobalSuppressionEntry,
    SystemMailConfigView,
)
from uniffy_proto.superadmin.v1.system_mail_pb2 import (
    OrgMailConfigSummary as OrgMailConfigSummaryProto,
)

from uniffy.core.models.mail.suppression import EmailSuppression
from uniffy.domains.mail.system.operations import (
    DeliveryRow,
    OrgMailConfigRow,
    SystemMailConfigSummary,
)


def _to_timestamp(value: datetime | None) -> Timestamp | None:
    if value is None:
        return None
    ts = Timestamp()
    ts.FromDatetime(value)
    return ts


def system_summary_to_proto(summary: SystemMailConfigSummary) -> SystemMailConfigView:
    """Map :class:`SystemMailConfigSummary` -> wire view."""
    return SystemMailConfigView(
        configured=summary.configured,
        effective_source=summary.effective_source,
        from_address=summary.from_address,
        from_name=summary.from_name,
        reply_to=summary.reply_to,
        smtp_host=summary.smtp_host,
        smtp_port=summary.smtp_port,
        smtp_username=summary.smtp_username,
        smtp_password_set=summary.smtp_password_set,
        smtp_use_tls=summary.smtp_use_tls,
        rate_limit_per_min=summary.rate_limit_per_min,
    )


def org_row_to_proto(row: OrgMailConfigRow) -> OrgMailConfigSummaryProto:
    """Map :class:`OrgMailConfigRow` -> wire summary entry."""
    msg = OrgMailConfigSummaryProto(
        organization_id=str(row.organization_id),
        organization_name=row.organization_name,
        organization_slug=row.organization_slug,
        effective_source=row.effective_source,
        from_address=row.from_address,
        smtp_host=row.smtp_host,
        smtp_password_set=row.smtp_password_set,
    )
    verified = _to_timestamp(row.verified_at)
    if verified is not None:
        msg.verified_at.CopyFrom(verified)
    last_test = _to_timestamp(row.last_test_at)
    if last_test is not None:
        msg.last_test_at.CopyFrom(last_test)
    if row.last_test_status is not None:
        msg.last_test_status = row.last_test_status
    return msg


def suppression_to_proto(entry: EmailSuppression) -> GlobalSuppressionEntry:
    msg = GlobalSuppressionEntry(
        id=str(entry.id),
        email=entry.email,
        reason=entry.reason.value if hasattr(entry.reason, "value") else str(entry.reason),
        source=entry.source,
    )
    ts = _to_timestamp(entry.created_at)
    if ts is not None:
        msg.created_at.CopyFrom(ts)
    return msg


def delivery_to_proto(row: DeliveryRow) -> GlobalDeliveryEntry:
    msg = GlobalDeliveryEntry(
        id=str(row.id),
        action=row.action,
        config_source=row.config_source,
    )
    ts = _to_timestamp(row.created_at)
    if ts is not None:
        msg.created_at.CopyFrom(ts)
    if row.organization_id is not None:
        msg.organization_id = str(row.organization_id)
    if row.organization_name is not None:
        msg.organization_name = row.organization_name
    if row.recipient is not None:
        msg.recipient = row.recipient
    if row.template is not None:
        msg.template = row.template
    if row.provider_message_id is not None:
        msg.provider_message_id = row.provider_message_id
    if row.error is not None:
        msg.error = row.error
    return msg
