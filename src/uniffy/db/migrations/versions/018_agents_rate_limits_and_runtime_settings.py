"""Per-org runtime governance: rate limits + runtime settings.

Revision ID: 018
Revises: 017
Create Date: 2026-05-01

One logical unit: per-organization knobs that govern how the agent
runtime behaves at request time. Rate-limit overrides shape the
inbound bucket caps; runtime settings shape the outbound LLM call
(send-deadline, failover toggle, resume toggle, circuit-breaker
tunables). The accompanying ``agents_run_logs`` columns
(``retry_count``, ``failover_provider_key_ids``, ``cancelled``,
``deadline_exceeded``) make every governance decision auditable.

Tables created:
- ``agents_rate_limits``        - per-org overrides for the 5 rate-limit kinds
- ``agents_runtime_settings``   - per-org runtime behaviour toggles

Columns added to ``agents_run_logs``:
- ``retry_count``
- ``failover_provider_key_ids``
- ``cancelled``
- ``deadline_exceeded``
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "018"
down_revision: str = "017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create governance tables and add audit columns to run_logs."""
    op.create_table(
        "agents_rate_limits",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("limit_kind", sa.String(length=32), nullable=False),
        sa.Column("limit", sa.Integer(), nullable=False),
        sa.Column("window_seconds", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.UniqueConstraint(
            "organization_id",
            "limit_kind",
            name="uq_agents_rate_limits_org_kind",
        ),
    )

    op.create_index(
        "ix_agents_rate_limits_org",
        "agents_rate_limits",
        ["organization_id"],
    )

    op.create_table(
        "agents_runtime_settings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("send_deadline_seconds", sa.Integer(), nullable=True),
        sa.Column(
            "failover_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            "resume_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            "circuit_breaker_failure_threshold",
            sa.Integer(),
            nullable=False,
            server_default="5",
        ),
        sa.Column(
            "circuit_breaker_recovery_seconds",
            sa.Integer(),
            nullable=False,
            server_default="60",
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.UniqueConstraint(
            "organization_id",
            name="uq_agents_runtime_settings_org",
        ),
    )

    op.add_column(
        "agents_run_logs",
        sa.Column(
            "retry_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "agents_run_logs",
        sa.Column(
            "failover_provider_key_ids",
            sa.JSON(),
            nullable=True,
        ),
    )
    op.add_column(
        "agents_run_logs",
        sa.Column(
            "cancelled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "agents_run_logs",
        sa.Column(
            "deadline_exceeded",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    """Drop governance tables and the new run-log columns."""
    op.drop_column("agents_run_logs", "deadline_exceeded")
    op.drop_column("agents_run_logs", "cancelled")
    op.drop_column("agents_run_logs", "failover_provider_key_ids")
    op.drop_column("agents_run_logs", "retry_count")

    op.drop_table("agents_runtime_settings")

    op.drop_index(
        "ix_agents_rate_limits_org",
        table_name="agents_rate_limits",
    )
    op.drop_table("agents_rate_limits")
