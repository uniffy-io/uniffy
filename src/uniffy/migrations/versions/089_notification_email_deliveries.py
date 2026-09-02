"""Add the durable notification email outbox.

Revision ID: 089
Revises: 088
Create Date: 2026-08-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "089"
down_revision: str | None = "088"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "notification_email_deliveries",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("notification_type", sa.String(50), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("body", sa.Text(), nullable=False, server_default=""),
        sa.Column("source_urn", sa.String(500), nullable=True),
        sa.Column("content_type", sa.String(50), nullable=True),
        sa.Column("content_id", sa.Uuid(), nullable=True),
        sa.Column("notification_metadata", postgresql.JSONB(), nullable=True),
        sa.Column("frequency", sa.String(16), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("provider_message_id", sa.String(500), nullable=True),
        sa.Column("terminal_reason", sa.String(100), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["login_organizations.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_id"], ["login_users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "event_id",
            "user_id",
            name="uq_notification_email_deliveries_event_user",
        ),
    )
    op.create_index(
        "ix_notification_email_deliveries_organization_id",
        "notification_email_deliveries",
        ["organization_id"],
    )
    op.create_index(
        "ix_notification_email_deliveries_user_id",
        "notification_email_deliveries",
        ["user_id"],
    )
    op.create_index(
        "ix_notification_email_deliveries_due",
        "notification_email_deliveries",
        ["status", "scheduled_for"],
    )
    op.create_index(
        "ix_notification_email_deliveries_digest",
        "notification_email_deliveries",
        ["organization_id", "user_id", "frequency", "scheduled_for"],
    )


def downgrade() -> None:
    op.drop_table("notification_email_deliveries")
