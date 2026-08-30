"""Calls domain tables: calls, participants, channel settings, org policies.

Revision ID: 054
Revises: 053
Create Date: 2026-07-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "054"
down_revision: str | None = "053"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_call_type_enum = postgresql.ENUM(
    "DIRECT",
    "GROUP_DM",
    "CHANNEL",
    name="calltype",
    create_type=False,
)

_call_end_reason_enum = postgresql.ENUM(
    "HOST_ENDED",
    "ALL_LEFT",
    "MAX_DURATION",
    "SOLO_TIMEOUT",
    "CHANNEL_ARCHIVED",
    name="callendreason",
    create_type=False,
)


def upgrade() -> None:
    postgresql.ENUM(
        "DIRECT",
        "GROUP_DM",
        "CHANNEL",
        name="calltype",
    ).create(op.get_bind(), checkfirst=True)
    postgresql.ENUM(
        "HOST_ENDED",
        "ALL_LEFT",
        "MAX_DURATION",
        "SOLO_TIMEOUT",
        "CHANNEL_ARCHIVED",
        name="callendreason",
    ).create(op.get_bind(), checkfirst=True)

    op.create_table(
        "calls_calls",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("channel_id", sa.Uuid(), nullable=False),
        sa.Column("call_type", _call_type_enum, nullable=False),
        sa.Column("initiator_user_id", sa.Uuid(), nullable=False),
        sa.Column("host_user_id", sa.Uuid(), nullable=False),
        sa.Column("livekit_room_name", sa.String(length=120), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_reason", _call_end_reason_enum, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["channel_id"], ["chat_channels.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["initiator_user_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(["host_user_id"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("livekit_room_name"),
    )
    op.create_index("ix_calls_calls_organization_id", "calls_calls", ["organization_id"])
    op.create_index("ix_calls_calls_channel_id", "calls_calls", ["channel_id"])
    op.create_index(
        "uq_calls_active_per_channel",
        "calls_calls",
        ["channel_id"],
        unique=True,
        postgresql_where=sa.text("ended_at IS NULL"),
    )

    op.create_table(
        "calls_participants",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("call_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("device_id", sa.String(length=64), nullable=False),
        sa.Column("identity", sa.String(length=120), nullable=False),
        sa.Column("device_label", sa.String(length=120), nullable=True),
        sa.Column("token_jti", sa.String(length=64), nullable=True),
        sa.Column("session_jti", sa.String(length=64), nullable=True),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("left_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("missing_since", sa.DateTime(timezone=True), nullable=True),
        sa.Column("mic_enabled", sa.Boolean(), nullable=False),
        sa.Column("camera_enabled", sa.Boolean(), nullable=False),
        sa.Column("screen_sharing", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["call_id"], ["calls_calls.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_calls_participants_call_id", "calls_participants", ["call_id"])
    op.create_index(
        "ix_calls_participants_organization_id", "calls_participants", ["organization_id"]
    )
    op.create_index("ix_calls_participants_user_id", "calls_participants", ["user_id"])
    op.create_index("ix_calls_participants_call_user", "calls_participants", ["call_id", "user_id"])
    op.create_index(
        "uq_calls_participants_active_identity",
        "calls_participants",
        ["call_id", "identity"],
        unique=True,
        postgresql_where=sa.text("left_at IS NULL"),
    )

    op.create_table(
        "calls_channel_settings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("channel_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("allow_member_publish", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["channel_id"], ["chat_channels.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("channel_id"),
    )
    op.create_index(
        "ix_calls_channel_settings_organization_id",
        "calls_channel_settings",
        ["organization_id"],
    )

    op.create_table(
        "calls_org_policies",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("calls_enabled", sa.Boolean(), nullable=False),
        sa.Column("max_participants", sa.Integer(), nullable=False),
        sa.Column("max_duration_minutes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id"),
    )


def downgrade() -> None:
    op.drop_table("calls_org_policies")
    op.drop_table("calls_channel_settings")
    op.drop_table("calls_participants")
    op.drop_table("calls_calls")
    postgresql.ENUM(name="callendreason").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="calltype").drop(op.get_bind(), checkfirst=True)
