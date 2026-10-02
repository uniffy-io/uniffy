"""Track durable realtime generations and pending projections."""

import sqlalchemy as sa
from alembic import op

revision = "108"
down_revision = "107"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("realtime_yjs_snapshots", sa.Column("seed_owner", sa.String(), nullable=True))
    op.add_column(
        "realtime_yjs_snapshots",
        sa.Column("seed_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("realtime_yjs_snapshots", sa.Column("organization_id", sa.Uuid(), nullable=True))
    op.add_column("realtime_yjs_snapshots", sa.Column("generation", sa.String(), nullable=True))
    op.add_column("realtime_yjs_snapshots", sa.Column("actor_id", sa.Uuid(), nullable=True))
    op.add_column(
        "realtime_yjs_snapshots",
        sa.Column("revision", sa.BigInteger(), nullable=False, server_default="0"),
    )
    op.add_column(
        "realtime_yjs_snapshots",
        sa.Column("rendered_revision", sa.BigInteger(), nullable=False, server_default="0"),
    )
    op.create_index(
        "ix_realtime_pending_projection",
        "realtime_yjs_snapshots",
        ["updated_at"],
        postgresql_where=sa.text("revision > rendered_revision"),
    )
    for content_type, table in (
        ("NOTE", "notes_notes"),
        ("TASK", "projects_tasks"),
        ("CALENDAR_EVENT", "calendar_events"),
    ):
        op.execute(
            sa.text(
                f"UPDATE realtime_yjs_snapshots AS snapshot SET organization_id = content.organization_id, revision = 1 "
                f"FROM {table} AS content WHERE snapshot.content_type = '{content_type}' AND snapshot.content_id = content.id"
            )
        )


def downgrade() -> None:
    op.drop_column("realtime_yjs_snapshots", "seed_expires_at")
    op.drop_column("realtime_yjs_snapshots", "seed_owner")
    op.drop_index("ix_realtime_pending_projection", table_name="realtime_yjs_snapshots")
    for column in ("rendered_revision", "revision", "actor_id", "generation", "organization_id"):
        op.drop_column("realtime_yjs_snapshots", column)
