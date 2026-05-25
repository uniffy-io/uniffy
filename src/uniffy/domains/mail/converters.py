"""Proto <-> domain mapping for the mail admin RPCs.

Strictly redacts secrets: every encrypted setting surfaces as a
``*_set`` boolean on the way out and is read straight from the
request on the way in. Plaintext never appears on a response message.
"""

from __future__ import annotations

from google.protobuf.timestamp_pb2 import Timestamp
from uniffy_proto.mail.v1.mail_pb2 import OrgMailConfigView

from uniffy.domains.mail.operations import OrgMailConfigSummary


def _to_timestamp(value) -> Timestamp | None:
    if value is None:
        return None
    ts = Timestamp()
    ts.FromDatetime(value)
    return ts


def summary_to_proto(summary: OrgMailConfigSummary) -> OrgMailConfigView:
    """Map ``OrgMailConfigSummary`` -> ``mail.v1.OrgMailConfigView``."""
    view = OrgMailConfigView(
        from_address=summary.from_address,
        from_name=summary.from_name,
        reply_to=summary.reply_to,
        smtp_host=summary.smtp_host,
        smtp_port=summary.smtp_port,
        smtp_username=summary.smtp_username,
        smtp_password_set=summary.smtp_password_set,
        smtp_use_tls=summary.smtp_use_tls,
        rate_limit_per_min=summary.rate_limit_per_min,
        has_org_config=summary.has_org_config,
        effective_source=summary.effective_source,
    )
    verified = _to_timestamp(summary.verified_at)
    if verified is not None:
        view.verified_at.CopyFrom(verified)
    last_test = _to_timestamp(summary.last_test_at)
    if last_test is not None:
        view.last_test_at.CopyFrom(last_test)
    if summary.last_test_status is not None:
        view.last_test_status = summary.last_test_status
    if summary.last_test_error is not None:
        view.last_test_error = summary.last_test_error
    return view
