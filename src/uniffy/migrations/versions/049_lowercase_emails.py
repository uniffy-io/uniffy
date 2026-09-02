"""Normalize stored emails to lowercase.

Revision ID: 049
Revises: 048
Create Date: 2026-05-28

Email is treated case-insensitively across the app. Existing rows from
the pre-prod period may carry mixed-case values; this migration folds
them and adds a CHECK constraint so any future row that bypasses the
``normalize_email`` helper at write time fails the insert rather than
silently desynchronising with login.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "049"
down_revision: str | None = "048"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("UPDATE login_users SET email = LOWER(email) WHERE email <> LOWER(email)")
    op.execute("UPDATE login_invitations SET email = LOWER(email) WHERE email <> LOWER(email)")
    op.create_check_constraint(
        "ck_login_users_email_lower",
        "login_users",
        "email = LOWER(email)",
    )
    op.create_check_constraint(
        "ck_login_invitations_email_lower",
        "login_invitations",
        "email = LOWER(email)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_login_invitations_email_lower", "login_invitations", type_="check")
    op.drop_constraint("ck_login_users_email_lower", "login_users", type_="check")
