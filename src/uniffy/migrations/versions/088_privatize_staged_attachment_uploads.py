"""Force OWNER_ONLY on files sitting in personal Attachments staging folders.

Revision ID: 088
Revises: 087
Create Date: 2026-08-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "088"
down_revision: str | None = "087"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Staged uploads inherited the org FILE default (often OPEN_TO_ORG) via
    # access_mode NULL; readers reach attachment bytes through the parent, so
    # the rows themselves are private.
    op.execute(
        sa.text(
            """
            UPDATE files_files AS f
            SET access_mode = 'OWNER_ONLY', baseline_role = NULL
            FROM files_folders AS d
            WHERE f.folder_id = d.id
              AND d.is_system = true
              AND d.is_org_attachments = false
              AND d.name = 'Attachments'
              AND d.parent_id IS NULL
              AND f.access_mode IS NULL
            """
        )
    )


def downgrade() -> None:
    pass
