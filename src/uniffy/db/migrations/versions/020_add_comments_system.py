"""Add comments system.

This migration:
1. Creates comment_anchor_type enum
2. Creates comments_comments table for content discussions
3. Creates comments_reactions table for emoji reactions

Revision ID: 020
Revises: 019
Create Date: 2026-02-13

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "020"
down_revision: str | None = "019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_content_type_enum = postgresql.ENUM(
    "NOTE",
    "FILE",
    "FOLDER",
    "CALENDAR_EVENT",
    "CHAT_MESSAGE",
    "USER",
    "PROJECT",
    "TASK",
    "AGENT",
    "PROVIDER_KEY",
    "PROMPT",
    "AGENT_CRON_TASK",
    "CHAT",
    "ROOM",
    name="contenttype",
    create_type=False,
)
_comment_anchor_type_enum = postgresql.ENUM(
    "PAGE",
    "SELECTION",
    "BLOCK",
    "MEDIA",
    name="comment_anchor_type",
    create_type=False,
)


def upgrade() -> None:
    """Add comments system tables."""
    # Create comment_anchor_type enum (checkfirst handles re-runs)
    postgresql.ENUM(
        "PAGE",
        "SELECTION",
        "BLOCK",
        "MEDIA",
        name="comment_anchor_type",
    ).create(op.get_bind(), checkfirst=True)

    # Create comments table
    op.create_table(
        "comments_comments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("content_type", _content_type_enum, nullable=False),
        sa.Column("content_id", sa.Uuid(), nullable=False),
        sa.Column("parent_comment_id", sa.Uuid(), nullable=True),
        sa.Column("author_id", sa.Uuid(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("anchor_type", _comment_anchor_type_enum, nullable=False, server_default="PAGE"),
        sa.Column("anchor_data", postgresql.JSONB(), nullable=True),
        sa.Column("is_resolved", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("resolved_by", sa.Uuid(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(
            ["parent_comment_id"],
            ["comments_comments.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["author_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(["resolved_by"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_comments_comments_organization_id",
        "comments_comments",
        ["organization_id"],
    )
    op.create_index(
        "ix_comments_comments_content_type",
        "comments_comments",
        ["content_type"],
    )
    op.create_index(
        "ix_comments_comments_content_id",
        "comments_comments",
        ["content_id"],
    )
    op.create_index(
        "ix_comments_comments_parent_comment_id",
        "comments_comments",
        ["parent_comment_id"],
    )
    op.create_index(
        "ix_comments_comments_author_id",
        "comments_comments",
        ["author_id"],
    )
    op.create_index(
        "ix_comments_org_content",
        "comments_comments",
        ["organization_id", "content_type", "content_id"],
    )

    # Create reactions table
    op.create_table(
        "comments_reactions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("comment_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("emoji", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["comment_id"],
            ["comments_comments.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("comment_id", "user_id", "emoji", name="uq_comment_reaction"),
    )
    op.create_index(
        "ix_comments_reactions_comment_id",
        "comments_reactions",
        ["comment_id"],
    )
    op.create_index(
        "ix_comments_reactions_user_id",
        "comments_reactions",
        ["user_id"],
    )


def downgrade() -> None:
    """Remove comments system tables."""
    op.drop_index("ix_comments_reactions_user_id", table_name="comments_reactions")
    op.drop_index("ix_comments_reactions_comment_id", table_name="comments_reactions")
    op.drop_table("comments_reactions")

    op.drop_index("ix_comments_org_content", table_name="comments_comments")
    op.drop_index("ix_comments_comments_author_id", table_name="comments_comments")
    op.drop_index("ix_comments_comments_parent_comment_id", table_name="comments_comments")
    op.drop_index("ix_comments_comments_content_id", table_name="comments_comments")
    op.drop_index("ix_comments_comments_content_type", table_name="comments_comments")
    op.drop_index("ix_comments_comments_organization_id", table_name="comments_comments")
    op.drop_table("comments_comments")

    # Drop comment_anchor_type enum
    postgresql.ENUM(name="comment_anchor_type").drop(op.get_bind(), checkfirst=True)
