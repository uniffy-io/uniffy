"""Realign org permission defaults to the collaborative seed.

Revision ID: 032
Revises: 031
Create Date: 2026-05-18

Rewrites ``permissions_org_defaults`` for NOTE and FILE to
``OPEN_TO_ORG`` (NOTE / EDITOR, FILE / VIEWER) so existing orgs pick
up the collaborative-by-default policy without admin intervention.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "032"
down_revision: str | None = "031"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE permissions_org_defaults
            SET default_access_mode = 'OPEN_TO_ORG',
                default_baseline_role = 'EDITOR'
            WHERE content_type = 'NOTE'
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE permissions_org_defaults
            SET default_access_mode = 'OPEN_TO_ORG',
                default_baseline_role = 'VIEWER'
            WHERE content_type = 'FILE'
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE permissions_org_defaults
            SET default_access_mode = 'OWNER_ONLY',
                default_baseline_role = NULL
            WHERE content_type IN ('NOTE', 'FILE')
            """
        )
    )
