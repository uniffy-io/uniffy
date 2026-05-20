"""Make access_mode nullable on every content table; NULL all existing rows.

Revision ID: 030
Revises: 029
Create Date: 2026-05-18

Switches the content access model to live org-default inheritance.
``NULL`` access_mode means "follow the per-org default for this content
type"; existing rows are NULLed to pick up the live default.
``baseline_role`` is also NULLed for consistency. A non-NULL
``access_mode`` paired with a NULL ``baseline_role`` is the
explicit-override-with-inherited-baseline shape.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "030"
down_revision: str | None = "029"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_TABLES = (
    "notes_notes",
    "files_files",
    "files_folders",
    "files_multipart_uploads",
    "calendar_events",
    "calendar_calendars",
    "calendar_event_templates",
    "projects_projects",
    "agents_agents",
    "agents_prompts",
    "agents_provider_keys",
    "agents_cron_tasks",
    "rooms_rooms",
)


def upgrade() -> None:
    for table in _TABLES:
        op.alter_column(table, "access_mode", nullable=True)
        op.execute(sa.text(f"UPDATE {table} SET access_mode = NULL, baseline_role = NULL"))


def downgrade() -> None:
    for table in _TABLES:
        op.execute(
            sa.text(
                f"UPDATE {table} SET access_mode = 'OWNER_ONLY' WHERE access_mode IS NULL"
            )
        )
        op.alter_column(table, "access_mode", nullable=False)
