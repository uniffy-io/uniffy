"""Persist content access requests.

Revision ID: 086
Revises: 085
Create Date: 2026-08-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "086"
down_revision: str | None = "085"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_state_enum = postgresql.ENUM(
    "PENDING",
    "APPROVED",
    "DENIED",
    "CANCELED",
    name="contentaccessrequeststate",
    create_type=False,
)
_content_type_enum = postgresql.ENUM(name="contenttype", create_type=False)
_content_role_enum = postgresql.ENUM(name="contentrole", create_type=False)


def upgrade() -> None:
    postgresql.ENUM(
        "PENDING",
        "APPROVED",
        "DENIED",
        "CANCELED",
        name="contentaccessrequeststate",
    ).create(op.get_bind(), checkfirst=True)

    op.create_table(
        "permissions_content_access_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("requester_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("requested_urn", sa.String(length=255), nullable=False),
        sa.Column("original_content_type", _content_type_enum, nullable=False),
        sa.Column("original_content_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("canonical_content_type", _content_type_enum, nullable=False),
        sa.Column("canonical_content_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("state", _state_enum, nullable=False, server_default="PENDING"),
        sa.Column("message", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("decision_note", sa.Text(), nullable=False, server_default=""),
        sa.Column("approved_role", _content_role_enum, nullable=True),
        sa.Column("responded_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["login_organizations.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["requester_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(["responded_by_user_id"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_content_access_request_pending_target",
        "permissions_content_access_requests",
        [
            "organization_id",
            "requester_id",
            "canonical_content_type",
            "canonical_content_id",
        ],
        unique=True,
        postgresql_where=sa.text("state = 'PENDING'"),
    )
    op.create_index(
        "ix_content_access_request_requester_recent",
        "permissions_content_access_requests",
        ["organization_id", "requester_id", "created_at"],
    )
    op.create_index(
        "ix_content_access_request_canonical_status",
        "permissions_content_access_requests",
        [
            "organization_id",
            "canonical_content_type",
            "canonical_content_id",
            "state",
            "created_at",
        ],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_content_access_request_canonical_status",
        table_name="permissions_content_access_requests",
    )
    op.drop_index(
        "ix_content_access_request_requester_recent",
        table_name="permissions_content_access_requests",
    )
    op.drop_index(
        "uq_content_access_request_pending_target",
        table_name="permissions_content_access_requests",
    )
    op.drop_table("permissions_content_access_requests")
    postgresql.ENUM(name="contentaccessrequeststate").drop(op.get_bind(), checkfirst=True)

