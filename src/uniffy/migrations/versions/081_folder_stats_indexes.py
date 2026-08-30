"""Composite (parent, is_deleted) indexes for the folder mention-stat aggregates.

Revision ID: 081
Revises: 080
Create Date: 2026-08-13
"""

from collections.abc import Sequence

from alembic import op

revision: str = "081"
down_revision: str | None = "080"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "ix_files_files_folder_id_is_deleted",
        "files_files",
        ["folder_id", "is_deleted"],
    )
    op.create_index(
        "ix_files_folders_parent_id_is_deleted",
        "files_folders",
        ["parent_id", "is_deleted"],
    )
    op.create_index(
        "ix_notes_notes_parent_id_is_deleted",
        "notes_notes",
        ["parent_id", "is_deleted"],
    )


def downgrade() -> None:
    op.drop_index("ix_notes_notes_parent_id_is_deleted", table_name="notes_notes")
    op.drop_index("ix_files_folders_parent_id_is_deleted", table_name="files_folders")
    op.drop_index("ix_files_files_folder_id_is_deleted", table_name="files_files")
