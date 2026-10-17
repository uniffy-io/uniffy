"""Retain pending projection effects and notification events."""

import sqlalchemy as sa
from alembic import op

revision = "109"
down_revision = "108"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "realtime_yjs_snapshots",
        sa.Column("effects_pending", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index(
        "ix_realtime_pending_effects",
        "realtime_yjs_snapshots",
        ["updated_at"],
        postgresql_where=sa.text("effects_pending"),
    )
    op.create_table(
        "notification_outbox",
        sa.Column("event_id", sa.Uuid(), primary_key=True),
        sa.Column(
            "organization_id",
            sa.Uuid(),
            sa.ForeignKey("login_organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("attempted_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_notification_outbox_organization_id", "notification_outbox", ["organization_id"]
    )
    op.create_index("ix_notification_outbox_attempted_at", "notification_outbox", ["attempted_at"])
    op.create_table(
        "files_inline_reconciliations",
        sa.Column("content_type", sa.String(), primary_key=True),
        sa.Column("content_id", sa.Uuid(), primary_key=True),
        sa.Column(
            "organization_id",
            sa.Uuid(),
            sa.ForeignKey("login_organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("attempted_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_files_inline_reconciliations_attempted_at",
        "files_inline_reconciliations",
        ["attempted_at"],
    )
    op.add_column("notifications", sa.Column("event_id", sa.Uuid(), nullable=True))
    op.create_unique_constraint(
        "uq_notification_event_user", "notifications", ["event_id", "user_id"]
    )


def downgrade() -> None:
    op.drop_table("files_inline_reconciliations")
    op.drop_constraint("uq_notification_event_user", "notifications", type_="unique")
    op.drop_column("notifications", "event_id")
    op.drop_table("notification_outbox")
    op.drop_index("ix_realtime_pending_effects", table_name="realtime_yjs_snapshots")
    op.drop_column("realtime_yjs_snapshots", "effects_pending")
