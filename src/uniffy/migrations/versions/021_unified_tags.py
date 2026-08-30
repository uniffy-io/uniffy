"""Create unified tags namespace.

Revision ID: 021
Revises: 020
Create Date: 2026-05-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "021"
down_revision: str | None = "020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tags",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("slug", sa.String(64), nullable=False),
        sa.Column("color", sa.String(24), nullable=True),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=True),
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
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["login_users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "slug", name="uq_tags_org_slug"),
    )
    op.create_index("ix_tags_organization_id", "tags", ["organization_id"])
    op.create_index("ix_tags_created_by", "tags", ["created_by"])

    op.create_table(
        "tag_assignments",
        sa.Column("tag_id", sa.Uuid(), nullable=False),
        sa.Column("content_urn", sa.String(500), nullable=False),
        sa.Column("content_type", sa.String(64), nullable=False),
        sa.Column(
            "sources",
            postgresql.ARRAY(sa.String(16)),
            nullable=False,
            server_default=sa.text("'{}'::varchar[]"),
        ),
        sa.Column("assigned_by", sa.Uuid(), nullable=True),
        sa.Column(
            "assigned_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["tag_id"], ["tags.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assigned_by"], ["login_users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("tag_id", "content_urn", name="pk_tag_assignments"),
    )
    op.create_index(
        "ix_tag_assignments_content_urn",
        "tag_assignments",
        ["content_urn"],
    )
    op.create_index(
        "ix_tag_assignments_tag_assigned_at",
        "tag_assignments",
        ["tag_id", sa.text("assigned_at DESC"), "content_urn"],
    )
    op.create_index(
        "ix_tag_assignments_tag_content_type",
        "tag_assignments",
        ["tag_id", "content_type"],
    )

    op.create_table(
        "tags_saved_filters",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.String(500), nullable=False, server_default=""),
        sa.Column(
            "icon",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "criteria",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("sort_by", sa.String(32), nullable=False, server_default="count"),
        sa.Column("sort_order", sa.String(8), nullable=False, server_default="desc"),
        sa.Column("is_preset", sa.Boolean(), nullable=False, server_default=sa.text("false")),
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
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "organization_id", "name", name="uq_tags_saved_filters_name"),
    )
    op.create_index(
        "ix_tags_saved_filters_user_org",
        "tags_saved_filters",
        ["user_id", "organization_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_tags_saved_filters_user_org", table_name="tags_saved_filters")
    op.drop_table("tags_saved_filters")
    op.drop_index("ix_tag_assignments_tag_content_type", table_name="tag_assignments")
    op.drop_index("ix_tag_assignments_tag_assigned_at", table_name="tag_assignments")
    op.drop_index("ix_tag_assignments_content_urn", table_name="tag_assignments")
    op.drop_table("tag_assignments")
    op.drop_index("ix_tags_created_by", table_name="tags")
    op.drop_index("ix_tags_organization_id", table_name="tags")
    op.drop_table("tags")
