"""composite pk for field definitions and views

Revision ID: 021
Revises: 020
Create Date: 2026-02-12 10:00:00.000000

"""
from collections.abc import Sequence
from typing import Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '021'
down_revision: Union[str, None] = '020'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Change field_definitions and views to composite primary keys."""
    # --- projects_field_definitions: PK (id) -> PK (id, project_id) ---
    op.drop_constraint(
        'projects_field_definitions_pkey',
        'projects_field_definitions',
        type_='primary',
    )
    op.create_primary_key(
        'projects_field_definitions_pkey',
        'projects_field_definitions',
        ['id', 'project_id'],
    )

    # --- projects_views: PK (id) -> PK (id, project_id) ---
    op.drop_constraint(
        'projects_views_pkey',
        'projects_views',
        type_='primary',
    )
    op.create_primary_key(
        'projects_views_pkey',
        'projects_views',
        ['id', 'project_id'],
    )


def downgrade() -> None:
    """Revert to single-column primary keys."""
    # --- projects_views: PK (id, project_id) -> PK (id) ---
    op.drop_constraint(
        'projects_views_pkey',
        'projects_views',
        type_='primary',
    )
    op.create_primary_key(
        'projects_views_pkey',
        'projects_views',
        ['id'],
    )

    # --- projects_field_definitions: PK (id, project_id) -> PK (id) ---
    op.drop_constraint(
        'projects_field_definitions_pkey',
        'projects_field_definitions',
        type_='primary',
    )
    op.create_primary_key(
        'projects_field_definitions_pkey',
        'projects_field_definitions',
        ['id'],
    )
