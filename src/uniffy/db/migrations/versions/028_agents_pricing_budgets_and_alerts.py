"""Cost tracking and budget enforcement for the agents domain.

Revision ID: 017
Revises: 016
Create Date: 2026-05-01

One logical unit: model pricing rows feed run-log cost columns, which
are then capped by org-level budgets, per-user quotas, and tracked by
budget-alert dedupe rows. Partial deploy of any subset would leave
cost computation broken, so they ship together.

Tables created:
- ``agents_model_pricing``     - effective-dated price rows per model
- ``agents_budgets``           - per-org monthly spend + image cap
- ``agents_user_quotas``       - per-user daily/monthly caps
- ``agents_budget_alerts``     - dedupe row per (scope, period, threshold)

Columns added to ``agents_run_logs``:
- ``kind`` ("chat" / "image")
- ``image_count``
- ``cost_usd``
- ``thinking_tokens``

Plus an index on ``agents_run_logs (organization_id, created_at, kind)``
for the budget-period probes that filter by kind.

Pricing rows are seeded from ``uniffy.domains.agents.pricing_seed``.
The import is done inside ``upgrade`` so a future rename / removal of
the seed module never blocks the schema change.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "028"
down_revision: str = "027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create pricing/budget tables, extend run_logs, seed pricing."""
    op.create_table(
        "agents_model_pricing",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("model", sa.String(length=100), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("input_per_1m_usd", sa.Numeric(10, 4), nullable=True),
        sa.Column("output_per_1m_usd", sa.Numeric(10, 4), nullable=True),
        sa.Column("cached_input_per_1m_usd", sa.Numeric(10, 4), nullable=True),
        sa.Column("thinking_per_1m_usd", sa.Numeric(10, 4), nullable=True),
        sa.Column("image_prices", sa.JSON(), nullable=True),
        sa.Column(
            "effective_from",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "effective_to",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "provider",
            "model",
            "effective_from",
            name="uq_agents_model_pricing_provider_model_from",
        ),
    )

    op.create_index(
        "ix_agents_model_pricing_lookup",
        "agents_model_pricing",
        ["provider", "model", "effective_from"],
    )

    op.create_table(
        "agents_budgets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("monthly_limit_usd", sa.Numeric(12, 2), nullable=True),
        sa.Column("image_monthly_limit", sa.Integer(), nullable=True),
        sa.Column(
            "hard_limit",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "alert_thresholds",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[50, 75, 90]'::jsonb"),
        ),
        sa.Column(
            "reset_day",
            sa.Integer(),
            nullable=False,
            server_default="1",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.UniqueConstraint(
            "organization_id",
            name="uq_agents_budgets_org",
        ),
    )

    op.create_table(
        "agents_user_quotas",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("daily_limit_usd", sa.Numeric(10, 2), nullable=True),
        sa.Column("monthly_limit_usd", sa.Numeric(10, 2), nullable=True),
        sa.Column("daily_image_limit", sa.Integer(), nullable=True),
        sa.Column("monthly_image_limit", sa.Integer(), nullable=True),
        sa.Column(
            "hard_limit",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"]),
        sa.UniqueConstraint(
            "organization_id",
            "user_id",
            name="uq_agents_user_quotas_org_user",
        ),
    )

    op.create_index(
        "ix_agents_user_quotas_user",
        "agents_user_quotas",
        ["user_id"],
    )

    op.create_table(
        "agents_budget_alerts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("scope", sa.String(length=16), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("threshold", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column(
            "fired_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"]),
        sa.UniqueConstraint(
            "scope",
            "organization_id",
            "user_id",
            "period_start",
            "threshold",
            "kind",
            name="uq_agents_budget_alerts_scope_key",
        ),
    )

    op.create_index(
        "ix_agents_budget_alerts_org_period",
        "agents_budget_alerts",
        ["organization_id", "period_start"],
    )

    op.add_column(
        "agents_run_logs",
        sa.Column(
            "kind",
            sa.String(length=16),
            nullable=False,
            server_default="chat",
        ),
    )
    op.add_column(
        "agents_run_logs",
        sa.Column(
            "image_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "agents_run_logs",
        sa.Column(
            "cost_usd",
            sa.Numeric(12, 6),
            nullable=True,
        ),
    )
    op.add_column(
        "agents_run_logs",
        sa.Column(
            "thinking_tokens",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )

    op.create_index(
        "ix_agents_run_logs_org_created_kind",
        "agents_run_logs",
        ["organization_id", "created_at", "kind"],
    )

    try:
        from datetime import UTC, datetime
        from uuid import uuid4

        from uniffy.domains.agents.pricing_seed import (
            IMAGE_PRICING_SEED,
            TEXT_PRICING_SEED,
        )
    except Exception:
        return

    now = datetime.now(UTC)
    bind = op.get_bind()
    table = sa.table(
        "agents_model_pricing",
        sa.column("id", sa.Uuid()),
        sa.column("provider", sa.String()),
        sa.column("model", sa.String()),
        sa.column("kind", sa.String()),
        sa.column("input_per_1m_usd", sa.Numeric(10, 4)),
        sa.column("output_per_1m_usd", sa.Numeric(10, 4)),
        sa.column("cached_input_per_1m_usd", sa.Numeric(10, 4)),
        sa.column("thinking_per_1m_usd", sa.Numeric(10, 4)),
        sa.column("image_prices", sa.JSON()),
        sa.column("effective_from", sa.DateTime(timezone=True)),
        sa.column("effective_to", sa.DateTime(timezone=True)),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )

    rows: list[dict] = []
    for entry in TEXT_PRICING_SEED:
        rows.append(
            {
                "id": uuid4(),
                "provider": entry["provider"],
                "model": entry["model"],
                "kind": "text",
                "input_per_1m_usd": entry.get("input_per_1m_usd"),
                "output_per_1m_usd": entry.get("output_per_1m_usd"),
                "cached_input_per_1m_usd": entry.get("cached_input_per_1m_usd"),
                "thinking_per_1m_usd": entry.get("thinking_per_1m_usd"),
                "image_prices": None,
                "effective_from": now,
                "effective_to": None,
                "created_at": now,
                "updated_at": now,
            }
        )
    for img in IMAGE_PRICING_SEED:
        prices = {
            size: {quality: str(price) for quality, price in qualities.items()}
            for size, qualities in img["image_prices"].items()
        }
        rows.append(
            {
                "id": uuid4(),
                "provider": img["provider"],
                "model": img["model"],
                "kind": "image",
                "input_per_1m_usd": None,
                "output_per_1m_usd": None,
                "cached_input_per_1m_usd": None,
                "thinking_per_1m_usd": None,
                "image_prices": prices,
                "effective_from": now,
                "effective_to": None,
                "created_at": now,
                "updated_at": now,
            }
        )

    if rows:
        bind.execute(table.insert(), rows)


def downgrade() -> None:
    """Reverse the upgrade in dependency order."""
    op.drop_index(
        "ix_agents_run_logs_org_created_kind",
        table_name="agents_run_logs",
    )
    op.drop_column("agents_run_logs", "thinking_tokens")
    op.drop_column("agents_run_logs", "cost_usd")
    op.drop_column("agents_run_logs", "image_count")
    op.drop_column("agents_run_logs", "kind")

    op.drop_index(
        "ix_agents_budget_alerts_org_period",
        table_name="agents_budget_alerts",
    )
    op.drop_table("agents_budget_alerts")

    op.drop_index("ix_agents_user_quotas_user", table_name="agents_user_quotas")
    op.drop_table("agents_user_quotas")
    op.drop_table("agents_budgets")

    op.drop_index(
        "ix_agents_model_pricing_lookup",
        table_name="agents_model_pricing",
    )
    op.drop_table("agents_model_pricing")
