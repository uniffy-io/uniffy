"""Store search removal filters as vendor-neutral expression trees.

Revision ID: 097
Revises: 096
Create Date: 2026-08-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "097"
down_revision: str | None = "096"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "search_removal_queue",
        sa.Column("filter_spec", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.execute(
        sa.text(
            """
            UPDATE search_removal_queue
            SET filter_spec = jsonb_build_object(
                'kind', 'all',
                'expressions', jsonb_build_array(
                    jsonb_build_object(
                        'kind', 'term',
                        'field', 'entity_type',
                        'value', (regexp_match(filter_expr, '^entity_type = "([^"]+)"'))[1]
                    ),
                    jsonb_build_object(
                        'kind', 'term',
                        'field', (regexp_match(filter_expr, 'AND (metadata\\.[a-z_]+) ='))[1],
                        'value', (regexp_match(filter_expr, 'AND metadata\\.[a-z_]+ = "([^"]+)"$'))[1]
                    )
                )
            )
            WHERE filter_expr ~ '^entity_type = "[a-z_]+" AND metadata\\.[a-z_]+ = "[^"]+"$'
            """
        )
    )
    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM search_removal_queue
                    WHERE filter_expr IS NOT NULL AND filter_spec IS NULL
                ) THEN
                    RAISE EXCEPTION 'search_removal_queue contains an unsupported filter expression';
                END IF;
            END
            $$
            """
        )
    )
    op.drop_constraint(
        "ck_search_removal_target",
        "search_removal_queue",
        type_="check",
    )
    op.drop_column("search_removal_queue", "filter_expr")
    op.create_check_constraint(
        "ck_search_removal_target",
        "search_removal_queue",
        "urn IS NOT NULL OR filter_spec IS NOT NULL",
    )


def downgrade() -> None:
    op.add_column(
        "search_removal_queue",
        sa.Column("filter_expr", sa.Text(), nullable=True),
    )
    op.execute(
        sa.text(
            """
            UPDATE search_removal_queue
            SET filter_expr = concat(
                'entity_type = "', filter_spec #>> '{expressions,0,value}',
                '" AND ', filter_spec #>> '{expressions,1,field}',
                ' = "', filter_spec #>> '{expressions,1,value}', '"'
            )
            WHERE filter_spec ->> 'kind' = 'all'
              AND jsonb_array_length(filter_spec -> 'expressions') = 2
            """
        )
    )
    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM search_removal_queue
                    WHERE filter_spec IS NOT NULL AND filter_expr IS NULL
                ) THEN
                    RAISE EXCEPTION 'search_removal_queue contains a filter that cannot be downgraded';
                END IF;
            END
            $$
            """
        )
    )
    op.drop_constraint(
        "ck_search_removal_target",
        "search_removal_queue",
        type_="check",
    )
    op.drop_column("search_removal_queue", "filter_spec")
    op.create_check_constraint(
        "ck_search_removal_target",
        "search_removal_queue",
        "urn IS NOT NULL OR filter_expr IS NOT NULL",
    )
