"""Enforce audit_events append-only at the database level.

Revision ID: 075
Revises: 074
Create Date: 2026-08-02

The application funnels every write through ``core/audit/writer.py``, but
nothing stopped a stray UPDATE, DELETE or TRUNCATE from rewriting history,
which is the property a compliance auditor actually tests. Triggers on the
partitioned parent propagate to existing and future partitions.

Maintenance that legitimately removes rows (partition drains, retention)
opts out for the length of its transaction with
``SET LOCAL uniffy.audit_maintenance = 'on'``. Dropping a whole partition is
DDL and never trips these triggers.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "075"
down_revision: str | None = "074"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION audit_events_reject_mutation()
        RETURNS trigger AS $$
        BEGIN
            IF coalesce(
                current_setting('uniffy.audit_maintenance', true), 'off'
            ) = 'on' THEN
                IF TG_OP = 'DELETE' THEN
                    RETURN OLD;
                END IF;
                RETURN NEW;
            END IF;

            RAISE EXCEPTION
                'audit_events is append-only (attempted %)', TG_OP
                USING ERRCODE = 'restrict_violation';
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        """
        CREATE TRIGGER audit_events_no_rewrite
            BEFORE UPDATE OR DELETE ON audit_events
            FOR EACH ROW EXECUTE FUNCTION audit_events_reject_mutation()
        """
    )
    op.execute(
        """
        CREATE TRIGGER audit_events_no_truncate
            BEFORE TRUNCATE ON audit_events
            FOR EACH STATEMENT EXECUTE FUNCTION audit_events_reject_mutation()
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS audit_events_no_truncate ON audit_events")
    op.execute("DROP TRIGGER IF EXISTS audit_events_no_rewrite ON audit_events")
    op.execute("DROP FUNCTION IF EXISTS audit_events_reject_mutation()")
