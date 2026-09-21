"""Remove independent organization baselines from attachment copies."""

from alembic import op

revision = "104"
down_revision = "103"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        UPDATE files_files AS file
        SET access_mode = 'OWNER_ONLY', baseline_role = NULL
        FROM attachments_attachments AS attachment
        WHERE file.id = attachment.file_id
          AND file.organization_id = attachment.organization_id
          AND (file.access_mode = 'OPEN_TO_ORG' OR file.access_mode IS NULL)
    """)


def downgrade() -> None:
    # Reopening attachment copies would bypass their parents' access decisions.
    pass
