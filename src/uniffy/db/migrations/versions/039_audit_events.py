"""Central audit_events table; drop legacy audit tables.

Revision ID: 039
Revises: 038
Create Date: 2026-05-20

Creates the partitioned ``audit_events`` table that becomes the single
source for every audit-relevant row in the product. The legacy
``permissions_content_member_events`` and ``agents_audit_logs`` tables
are dropped in the same revision. No backfill - pre-production product,
no historical audit data worth preserving.

Partitioning: monthly RANGE on ``created_at``. Initial partitions for
the previous, current, and next two months are pre-created here. A
later phase ships an ARQ cron job that rolls partitions forward
automatically.

Indexes are created on the partitioned parent; PostgreSQL propagates
them to existing and future partitions.
"""

from collections.abc import Sequence
from datetime import UTC, date, datetime

from alembic import op

revision: str = "039"
down_revision: str | None = "038"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _month_floor(value: date) -> date:
    return value.replace(day=1)


def _next_month(value: date) -> date:
    year = value.year + (1 if value.month == 12 else 0)
    month = 1 if value.month == 12 else value.month + 1
    return date(year, month, 1)


def _prev_month(value: date) -> date:
    year = value.year - (1 if value.month == 1 else 0)
    month = 12 if value.month == 1 else value.month - 1
    return date(year, month, 1)


def _initial_partition_bounds() -> list[tuple[date, date]]:
    """Return [(from_inclusive, to_exclusive), ...] for prev/cur/+1/+2."""
    current = _month_floor(datetime.now(UTC).date())
    previous = _prev_month(current)
    plus_one = _next_month(current)
    plus_two = _next_month(plus_one)
    plus_three = _next_month(plus_two)
    return [
        (previous, current),
        (current, plus_one),
        (plus_one, plus_two),
        (plus_two, plus_three),
    ]


def _partition_name(starts: date) -> str:
    return f"audit_events_{starts.year:04d}_{starts.month:02d}"


def upgrade() -> None:
    """Create the audit_events table + indexes and drop legacy tables."""
    op.execute(
        """
        CREATE TABLE audit_events (
            id UUID NOT NULL,
            organization_id UUID NULL,
            actor_user_id UUID NULL,
            actor_org_role VARCHAR(32) NULL,
            on_behalf_of_user_id UUID NULL,
            action VARCHAR(64) NOT NULL,
            resource_type VARCHAR(32) NULL,
            resource_id UUID NULL,
            details JSONB NOT NULL DEFAULT '{}'::jsonb,
            ip_address INET NULL,
            user_agent VARCHAR(512) NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (id, created_at)
        ) PARTITION BY RANGE (created_at)
        """
    )

    for starts, ends in _initial_partition_bounds():
        op.execute(
            f"""
            CREATE TABLE {_partition_name(starts)}
                PARTITION OF audit_events
                FOR VALUES FROM ('{starts.isoformat()}')
                TO ('{ends.isoformat()}')
            """
        )

    op.execute(
        "CREATE INDEX ix_audit_org_created ON audit_events "
        "(organization_id, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX ix_audit_actor_created ON audit_events "
        "(actor_user_id, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX ix_audit_resource_created ON audit_events "
        "(resource_type, resource_id, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX ix_audit_org_action_created ON audit_events "
        "(organization_id, action, created_at DESC)"
    )

    op.execute("DROP TABLE IF EXISTS permissions_content_member_events")
    op.execute("DROP TABLE IF EXISTS agents_audit_logs")


def downgrade() -> None:
    """Drop audit_events and recreate the legacy tables as empty shells.

    The legacy shells are recreated bare (no indexes, no enum
    decoration) so a downgrade does not leave foreign-key-style
    references dangling; production rollback paths are not designed
    against this revision because the parent ticket is shipped from a
    pre-production tree per ``feedback_no_backwards_compat``.
    """
    op.execute("DROP TABLE IF EXISTS audit_events CASCADE")

    op.execute(
        """
        CREATE TABLE permissions_content_member_events (
            id UUID PRIMARY KEY,
            organization_id UUID NOT NULL,
            content_type VARCHAR(64) NOT NULL,
            content_id UUID NOT NULL,
            action VARCHAR(64) NOT NULL,
            subject_type VARCHAR(32) NULL,
            subject_id UUID NULL,
            previous_role VARCHAR(32) NULL,
            new_role VARCHAR(32) NULL,
            previous_access_mode VARCHAR(32) NULL,
            new_access_mode VARCHAR(32) NULL,
            previous_baseline_role VARCHAR(32) NULL,
            new_baseline_role VARCHAR(32) NULL,
            previous_owner_id UUID NULL,
            new_owner_id UUID NULL,
            actor_user_id UUID NOT NULL,
            actor_org_role VARCHAR(32) NOT NULL,
            note VARCHAR(500) NOT NULL DEFAULT '',
            occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE agents_audit_logs (
            id UUID PRIMARY KEY,
            organization_id UUID NOT NULL,
            user_id UUID NOT NULL,
            action VARCHAR(100) NOT NULL,
            resource_type VARCHAR(50) NOT NULL,
            resource_id UUID NOT NULL,
            details JSONB NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
