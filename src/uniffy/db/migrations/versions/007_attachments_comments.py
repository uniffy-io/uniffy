"""Create attachments + comments domain tables.

Revision ID: 007
Revises: 006
Create Date: 2026-02-05

Consolidates (original dates):
  - attachments_attachments (2026-02-05)
  - comments_comments + comments_reactions + comment_anchor_type (2026-02-13)
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "007"
down_revision: str | None = "006"
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
    "PAGE", "SELECTION", "BLOCK", "MEDIA", name="comment_anchor_type", create_type=False
)


def upgrade() -> None:
    """Create attachments and comments tables."""
    op.create_table(
        "attachments_attachments",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("file_id", sa.Uuid(), nullable=False),
        sa.Column("content_type", _content_type_enum, nullable=False),
        sa.Column("content_id", sa.Uuid(), nullable=False),
        sa.Column("attached_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("attached_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["file_id"], ["files_files.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["attached_by_user_id"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_attachments_attachments_organization_id",
        "attachments_attachments",
        ["organization_id"],
    )
    op.create_index(
        "ix_attachments_attachments_file_id",
        "attachments_attachments",
        ["file_id"],
        unique=True,
    )
    op.create_index(
        "ix_attachments_attachments_content_type",
        "attachments_attachments",
        ["content_type"],
    )
    op.create_index(
        "ix_attachments_attachments_content_id", "attachments_attachments", ["content_id"]
    )
    op.create_index(
        "ix_attachments_attachments_attached_by_user_id",
        "attachments_attachments",
        ["attached_by_user_id"],
    )
    op.create_index(
        "ix_attachments_content",
        "attachments_attachments",
        ["content_type", "content_id"],
    )

    op.create_table(
        "comments_comments",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("content_type", _content_type_enum, nullable=False),
        sa.Column("content_id", sa.Uuid(), nullable=False),
        sa.Column("parent_comment_id", sa.Uuid(), nullable=True),
        sa.Column("author_id", sa.Uuid(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "anchor_type",
            _comment_anchor_type_enum,
            nullable=False,
            server_default="PAGE",
        ),
        sa.Column("anchor_data", postgresql.JSONB(), nullable=True),
        sa.Column("is_resolved", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("resolved_by", sa.Uuid(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(
            ["parent_comment_id"], ["comments_comments.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["author_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(["resolved_by"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_comments_comments_organization_id", "comments_comments", ["organization_id"]
    )
    op.create_index(
        "ix_comments_comments_content_type", "comments_comments", ["content_type"]
    )
    op.create_index("ix_comments_comments_content_id", "comments_comments", ["content_id"])
    op.create_index(
        "ix_comments_comments_parent_comment_id",
        "comments_comments",
        ["parent_comment_id"],
    )
    op.create_index("ix_comments_comments_author_id", "comments_comments", ["author_id"])
    op.create_index(
        "ix_comments_org_content",
        "comments_comments",
        ["organization_id", "content_type", "content_id"],
    )

    op.create_table(
        "comments_reactions",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("comment_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("emoji", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["comment_id"], ["comments_comments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("comment_id", "user_id", "emoji", name="uq_comment_reaction"),
    )
    op.create_index("ix_comments_reactions_comment_id", "comments_reactions", ["comment_id"])
    op.create_index("ix_comments_reactions_user_id", "comments_reactions", ["user_id"])


def downgrade() -> None:
    """Drop attachments and comments tables."""
    op.drop_table("comments_reactions")
    op.drop_table("comments_comments")
    op.drop_table("attachments_attachments")
