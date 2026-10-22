"""Add project time periods and timesheets for the approval cycle.

A period row exists only once an admin closes it and a sheet row only after
its first state change; both tables start empty.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "116"
down_revision: str | None = "115"
branch_labels: str | None = None
depends_on: str | None = None

_PERIODS = "projects_time_periods"
_SHEETS = "projects_timesheets"


def upgrade() -> None:
    op.create_table(
        _PERIODS,
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Uuid(),
            sa.ForeignKey("login_organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("closed_by_user_id", sa.Uuid(), sa.ForeignKey("login_users.id"), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("organization_id", "start_date", name="uq_projects_time_periods_start"),
    )

    op.create_table(
        _SHEETS,
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Uuid(),
            sa.ForeignKey("login_organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("login_users.id"), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitted_by_user_id", sa.Uuid(), sa.ForeignKey("login_users.id"), nullable=True),
        sa.Column("submit_comment", sa.Text(), nullable=False, server_default=""),
        sa.Column("reviewer_user_id", sa.Uuid(), sa.ForeignKey("login_users.id"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_comment", sa.Text(), nullable=False, server_default=""),
        sa.Column("grace_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "organization_id", "user_id", "period_start", name="uq_projects_timesheets_person"
        ),
    )
    # The reviewer inbox reads one period of one organization.
    op.create_index(
        "ix_projects_timesheets_org_period", _SHEETS, ["organization_id", "period_start"]
    )


def downgrade() -> None:
    op.drop_index("ix_projects_timesheets_org_period", table_name=_SHEETS)
    op.drop_table(_SHEETS)
    op.drop_table(_PERIODS)
