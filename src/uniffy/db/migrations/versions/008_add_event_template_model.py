"""Add event template model

Revision ID: 008
Revises: 007
Create Date: 2026-01-26 15:45:16.878557

"""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
import sqlmodel
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_access_mode_enum = postgresql.ENUM(
    "OWNER_ONLY",
    "EXPLICIT_MEMBERS",
    "OPEN_TO_ORG",
    name="accessmode",
    create_type=False,
)
_content_role_enum = postgresql.ENUM(
    "OWNER",
    "ADMIN",
    "EDITOR",
    "COMMENTER",
    "VIEWER",
    "BLOCKED",
    name="contentrole",
    create_type=False,
)


def upgrade() -> None:
    """Upgrade database schema."""
    op.create_table(
        "calendar_event_templates",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("title", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("description", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column("location", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("meeting_url", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column("tags", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "access_mode", _access_mode_enum, nullable=False, server_default="OPEN_TO_ORG"
        ),
        sa.Column(
            "baseline_role", _content_role_enum, nullable=True, server_default="VIEWER"
        ),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_calendar_event_templates_organization_id"),
        "calendar_event_templates",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_calendar_event_templates_access_mode"),
        "calendar_event_templates",
        ["access_mode"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade database schema."""
    op.drop_index(
        op.f("ix_calendar_event_templates_access_mode"), table_name="calendar_event_templates"
    )
    op.drop_index(
        op.f("ix_calendar_event_templates_organization_id"), table_name="calendar_event_templates"
    )
    op.drop_table("calendar_event_templates")
