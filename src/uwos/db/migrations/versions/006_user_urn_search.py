"""Add composite primary key to search_index and index existing users.

Revision ID: 006
Revises: 005
Create Date: 2026-01-16

This migration:
1. Changes search_index primary key from (urn) to (urn, organization_id)
   to allow the same URN to appear in multiple organizations (e.g., users)
2. Indexes all existing active users for their organization memberships

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "006"
down_revision: str | None = "005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Update search_index to composite PK and index existing users."""
    # Step 1: Drop the existing primary key constraint
    op.drop_constraint("search_index_pkey", "search_index", type_="primary")

    # Step 2: Create new composite primary key (urn, organization_id)
    op.create_primary_key(
        "search_index_pkey",
        "search_index",
        ["urn", "organization_id"],
    )

    # Step 3: Index all existing active users for their organizations
    # This inserts a search_index entry for each (user, organization) pair
    op.execute("""
        INSERT INTO search_index (
            urn,
            organization_id,
            title,
            description,
            keywords,
            entity_type,
            url_path,
            visibility,
            owner_id,
            shared_group_ids,
            shared_user_ids,
            updated_at,
            rank_score
        )
        SELECT
            'urn:uwos:content:USER:' || u.id::text AS urn,
            om.organization_id,
            COALESCE(u.full_name, u.username) AS title,
            u.email AS description,
            u.username || ' ' || u.email || ' ' || COALESCE(u.full_name, '') AS keywords,
            'user' AS entity_type,
            '/users/' || u.id::text AS url_path,
            'ORGANIZATION' AS visibility,
            u.id AS owner_id,
            NULL AS shared_group_ids,
            NULL AS shared_user_ids,
            NOW() AS updated_at,
            1.5 AS rank_score
        FROM login_users u
        INNER JOIN login_organization_members om ON u.id = om.user_id
        WHERE u.is_active = true AND om.is_active = true
        ON CONFLICT (urn, organization_id) DO NOTHING
    """)


def downgrade() -> None:
    """Revert to simple primary key on urn only."""
    # Remove user entries from search index
    op.execute("""
        DELETE FROM search_index WHERE entity_type = 'user'
    """)

    # Drop composite primary key
    op.drop_constraint("search_index_pkey", "search_index", type_="primary")

    # Recreate simple primary key on urn
    op.create_primary_key(
        "search_index_pkey",
        "search_index",
        ["urn"],
    )
