"""Record the invoked skill on an agent message for an in-conversation log.

Revision ID: 053
Revises: 052
Create Date: 2026-06-21

Adds ``agents_messages.invoked_skill_name`` - the display name of the skill a
user ran via the slash menu for that turn, denormalized so the conversation
keeps a self-contained record even after the skill is renamed or deleted.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "053"
down_revision: str | None = "052"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agents_messages",
        sa.Column("invoked_skill_name", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agents_messages", "invoked_skill_name")
