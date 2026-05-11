"""Add edit / delete / retry support fields to agents_messages.

Revision ID: 016
Revises: 015
Create Date: 2026-05-01

Adds:
- ``is_invalidated`` (bool, default false): the message has been
  superseded by an edit, delete, or retry on this or an earlier
  message. The runtime context loader skips invalidated rows; the UI
  may still render them as struck-through history.
- ``invalidated_at`` (timestamptz, nullable): when invalidation
  happened. Powers the audit log and any future retention policy.
- ``invalidated_by`` (uuid, nullable): the user who triggered the
  invalidation. Always the session owner today, but recorded
  explicitly for forensics.
- ``edited_at`` (timestamptz, nullable): set on the user message that
  was edited. Null otherwise.
- ``previous_content`` (text, nullable): pre-edit content snapshot.
  Populated only on edit; bounded by the original message size.

Plus a partial index ``ix_agents_messages_session_not_invalidated`` on
``(session_id, created_at)`` filtered to ``is_invalidated = false`` so
context loads stay cheap as the invalidated-row fraction grows.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "027"
down_revision: str | None = "026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add invalidation + edit columns and the partial active index."""
    op.add_column(
        "agents_messages",
        sa.Column(
            "is_invalidated",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "agents_messages",
        sa.Column(
            "invalidated_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "agents_messages",
        sa.Column(
            "invalidated_by",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.add_column(
        "agents_messages",
        sa.Column(
            "edited_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "agents_messages",
        sa.Column(
            "previous_content",
            sa.Text(),
            nullable=True,
        ),
    )

    op.create_index(
        "ix_agents_messages_session_not_invalidated",
        "agents_messages",
        ["session_id", "created_at"],
        postgresql_where=sa.text("is_invalidated = false"),
    )


def downgrade() -> None:
    """Drop the invalidation index and columns."""
    op.drop_index(
        "ix_agents_messages_session_not_invalidated",
        table_name="agents_messages",
    )
    op.drop_column("agents_messages", "previous_content")
    op.drop_column("agents_messages", "edited_at")
    op.drop_column("agents_messages", "invalidated_by")
    op.drop_column("agents_messages", "invalidated_at")
    op.drop_column("agents_messages", "is_invalidated")
