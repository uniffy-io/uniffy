"""Use faster snapshot compression and index the complete recovery predicate."""

import sqlalchemy as sa
from alembic import op

revision = "110"
down_revision = "109"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_settings
                WHERE name = 'default_toast_compression' AND 'lz4' = ANY(enumvals)
            ) THEN
                ALTER TABLE realtime_yjs_snapshots ALTER COLUMN updates SET COMPRESSION lz4;
            ELSE
                RAISE NOTICE 'LZ4 unavailable. Keeping snapshot compression unchanged.';
            END IF;
        END $$;
    """)
    op.create_index(
        "ix_realtime_pending_recovery",
        "realtime_yjs_snapshots",
        ["updated_at"],
        postgresql_where=sa.text("revision > rendered_revision OR effects_pending IS TRUE"),
    )
    op.drop_index("ix_realtime_pending_projection", table_name="realtime_yjs_snapshots")
    op.drop_index("ix_realtime_pending_effects", table_name="realtime_yjs_snapshots")


def downgrade() -> None:
    op.create_index(
        "ix_realtime_pending_projection",
        "realtime_yjs_snapshots",
        ["updated_at"],
        postgresql_where=sa.text("revision > rendered_revision"),
    )
    op.create_index(
        "ix_realtime_pending_effects",
        "realtime_yjs_snapshots",
        ["updated_at"],
        postgresql_where=sa.text("effects_pending"),
    )
    op.drop_index("ix_realtime_pending_recovery", table_name="realtime_yjs_snapshots")
    op.execute("ALTER TABLE realtime_yjs_snapshots ALTER COLUMN updates SET COMPRESSION default")
