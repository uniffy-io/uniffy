"""Backfill semantic roles on canonical project status options.

Revision ID: 085
Revises: 084
Create Date: 2026-08-15
"""

from collections.abc import Sequence

from alembic import op

revision: str = "085"
down_revision: str | None = "084"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE projects_field_definitions AS field
        SET config = jsonb_set(
            field.config,
            '{options}',
            (
                SELECT jsonb_agg(
                    CASE option->>'id'
                        WHEN 'status_todo' THEN option || '{"semantic":"todo"}'::jsonb
                        WHEN 'status_in_progress'
                            THEN option || '{"semantic":"in_progress"}'::jsonb
                        WHEN 'status_review' THEN option || '{"semantic":"review"}'::jsonb
                        WHEN 'status_done' THEN option || '{"semantic":"completed"}'::jsonb
                        ELSE option
                    END
                    ORDER BY ordinal
                )
                FROM jsonb_array_elements(field.config->'options')
                    WITH ORDINALITY AS options(option, ordinal)
            )
        )
        WHERE field.id = 'field_status'
          AND jsonb_typeof(field.config->'options') = 'array'
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE projects_field_definitions AS field
        SET config = jsonb_set(
            field.config,
            '{options}',
            (
                SELECT jsonb_agg((option - 'semantic') ORDER BY ordinal)
                FROM jsonb_array_elements(field.config->'options')
                    WITH ORDINALITY AS options(option, ordinal)
            )
        )
        WHERE field.id = 'field_status'
          AND jsonb_typeof(field.config->'options') = 'array'
        """
    )
