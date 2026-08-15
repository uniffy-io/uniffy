"""Normalize audit resource types to their canonical enum values.

Revision ID: 084
Revises: 083
Create Date: 2026-08-15
"""

from collections.abc import Sequence

from alembic import op

revision: str = "084"
down_revision: str | None = "083"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_LEGACY_LOWERCASE_TYPES = (
    "agent",
    "agent_runtime_settings",
    "budget",
    "currency_rate",
    "deployment_encryption_key",
    "email",
    "integration_connection",
    "mail_config",
    "mail_suppression",
    "organization",
    "provider_key",
    "rate_limit",
    "runtime_settings",
    "skill",
    "support_session",
    "system_flag",
    "system_mail_config",
    "user_quota",
)


def upgrade() -> None:
    quoted = ", ".join(f"'{value}'" for value in _LEGACY_LOWERCASE_TYPES)
    op.execute("SET LOCAL uniffy.audit_maintenance = 'on'")
    op.execute(
        f"UPDATE audit_events SET resource_type = upper(resource_type) "
        f"WHERE resource_type IN ({quoted})"
    )


def downgrade() -> None:
    quoted = ", ".join(f"'{value.upper()}'" for value in _LEGACY_LOWERCASE_TYPES)
    op.execute("SET LOCAL uniffy.audit_maintenance = 'on'")
    op.execute(
        f"UPDATE audit_events SET resource_type = lower(resource_type) "
        f"WHERE resource_type IN ({quoted})"
    )
