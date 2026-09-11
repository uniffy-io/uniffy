"""Hold pending event mail so a send that never happens stays recoverable.

Revision ID: 100
Revises: 099
Create Date: 2026-09-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "100"
down_revision: str | None = "099"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "calendar_mail_deliveries"
_PENDING_INDEX = "uq_calendar_mail_deliveries_pending"
_DUE_INDEX = "ix_calendar_mail_deliveries_due"

_kind_enum = postgresql.ENUM(
    "INVITATION",
    "CHANGE",
    "CANCELLATION",
    name="calendarmailkind",
    create_type=False,
)
_status_enum = postgresql.ENUM(
    "PENDING",
    "SENT",
    "FAILED",
    name="calendarmailstatus",
    create_type=False,
)


def upgrade() -> None:
    postgresql.ENUM(
        "INVITATION", "CHANGE", "CANCELLATION", name="calendarmailkind"
    ).create(op.get_bind(), checkfirst=True)
    postgresql.ENUM("PENDING", "SENT", "FAILED", name="calendarmailstatus").create(
        op.get_bind(), checkfirst=True
    )

    op.create_table(
        _TABLE,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("recipient_user_id", sa.Uuid(), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=True),
        sa.Column("kind", _kind_enum, nullable=False),
        sa.Column("status", _status_enum, nullable=False),
        sa.Column("occurrence_date", sa.Date(), nullable=True),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.String(length=1000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["event_id"], ["calendar_events.id"]),
        sa.ForeignKeyConstraint(["recipient_user_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(["actor_user_id"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(f"ix_{_TABLE}_organization_id", _TABLE, ["organization_id"])
    op.create_index(f"ix_{_TABLE}_event_id", _TABLE, ["event_id"])
    op.create_index(f"ix_{_TABLE}_recipient_user_id", _TABLE, ["recipient_user_id"])
    op.create_index(f"ix_{_TABLE}_scheduled_for", _TABLE, ["scheduled_for"])
    op.create_index(
        _DUE_INDEX,
        _TABLE,
        ["scheduled_for"],
        postgresql_where=sa.text("status = 'PENDING'"),
    )
    # A burst of edits must collapse onto one pending row. NULLS NOT DISTINCT
    # makes that hold for series-wide mail, where occurrence_date is absent.
    op.execute(
        f"CREATE UNIQUE INDEX {_PENDING_INDEX} ON {_TABLE} "
        "(event_id, recipient_user_id, kind, occurrence_date) NULLS NOT DISTINCT "
        "WHERE status = 'PENDING'"
    )


def downgrade() -> None:
    op.drop_index(_PENDING_INDEX, table_name=_TABLE)
    op.drop_index(_DUE_INDEX, table_name=_TABLE)
    op.drop_table(_TABLE)
    sa.Enum(name="calendarmailstatus").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="calendarmailkind").drop(op.get_bind(), checkfirst=True)
