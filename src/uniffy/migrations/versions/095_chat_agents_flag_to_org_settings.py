"""Move chat agents_enabled into the org_settings chat policy blob and drop
login_organizations.settings, which held nothing else.

Existing per-org values are materialized with the old reader's semantics
(absent key = disabled) so no org changes behavior; the resolver's coded
default of enabled applies only to organizations created after this.

Revision ID: 095
Revises: 094
Create Date: 2026-08-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "095"
down_revision: str | None = "094"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO org_settings
            (organization_id, namespace, key, value, is_secret, created_at, updated_at)
        SELECT
            id,
            'chat',
            'policy',
            jsonb_build_object(
                'agents_enabled',
                COALESCE((settings #>> '{chat,agents_enabled}')::boolean, false)
            ),
            false,
            now(),
            now()
        FROM login_organizations
        ON CONFLICT (organization_id, namespace, key)
        DO UPDATE SET
            value = org_settings.value || excluded.value,
            updated_at = now()
        """
    )
    op.drop_column("login_organizations", "settings")


def downgrade() -> None:
    op.add_column("login_organizations", sa.Column("settings", JSONB, nullable=True))
    op.execute(
        """
        UPDATE login_organizations o
        SET settings = jsonb_build_object(
            'chat', jsonb_build_object(
                'agents_enabled', COALESCE((s.value ->> 'agents_enabled')::boolean, false)
            )
        )
        FROM org_settings s
        WHERE s.organization_id = o.id AND s.namespace = 'chat' AND s.key = 'policy'
        """
    )
    op.execute(
        """
        UPDATE org_settings
        SET value = value - 'agents_enabled', updated_at = now()
        WHERE namespace = 'chat' AND key = 'policy'
        """
    )
