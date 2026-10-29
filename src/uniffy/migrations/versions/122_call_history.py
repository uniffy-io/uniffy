"""Persist call invitations and searchable history."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "122"
down_revision = "121"
branch_labels = None
depends_on = None

_outcome = postgresql.ENUM(
    "RINGING", "ANSWERED", "DECLINED", "MISSED", name="callinvitationoutcome", create_type=False
)


def upgrade() -> None:
    _outcome.create(op.get_bind(), checkfirst=True)
    op.execute("ALTER TYPE contenttype ADD VALUE IF NOT EXISTS 'CALL'")
    op.add_column(
        "calls_calls", sa.Column("title", sa.String(500), nullable=False, server_default="Call")
    )
    op.add_column(
        "calls_calls",
        sa.Column("search_pending", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.execute(
        "UPDATE calls_calls SET title = COALESCE(NULLIF(chat_channels.name, ''), 'Call') FROM chat_channels WHERE chat_channels.id = calls_calls.channel_id"
    )
    op.create_index(
        "ix_calls_history_org",
        "calls_calls",
        ["organization_id", sa.text("started_at DESC"), sa.text("id DESC")],
    )
    op.create_index(
        "ix_calls_history_channel",
        "calls_calls",
        ["organization_id", "channel_id", sa.text("started_at DESC"), sa.text("id DESC")],
    )
    op.create_index(
        "ix_calls_search_pending", "calls_calls", ["id"], postgresql_where=sa.text("search_pending")
    )
    op.create_index(
        "ix_calls_attendance_user", "calls_participants", ["organization_id", "user_id", "call_id"]
    )
    op.create_table(
        "calls_invitations",
        sa.Column(
            "call_id",
            sa.Uuid(),
            sa.ForeignKey("calls_calls.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("login_users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "organization_id", sa.Uuid(), sa.ForeignKey("login_organizations.id"), nullable=False
        ),
        sa.Column("outcome", _outcome, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("responded_at", sa.DateTime(timezone=True)),
    )
    op.create_index(
        "ix_calls_invitations_user", "calls_invitations", ["organization_id", "user_id", "call_id"]
    )
    op.create_index(
        "ix_calls_invitations_pending",
        "calls_invitations",
        ["expires_at"],
        postgresql_where=sa.text("outcome = 'RINGING'"),
    )


def downgrade() -> None:
    op.drop_table("calls_invitations")
    _outcome.drop(op.get_bind())
    op.drop_index("ix_calls_attendance_user", table_name="calls_participants")
    for name in ("ix_calls_search_pending", "ix_calls_history_channel", "ix_calls_history_org"):
        op.drop_index(name, table_name="calls_calls")
    op.drop_column("calls_calls", "search_pending")
    op.drop_column("calls_calls", "title")
