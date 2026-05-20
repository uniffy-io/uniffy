"""Multi-currency support for the agents domain.

Adds per-pricing-row currency declarations, per-org display currency,
and a per-org exchange-rate table. Renames columns that hardcoded
USD in their names to currency-neutral names plus a companion
currency column. Storage normalization: at INSERT time the runtime
computes cost in ``pricing.currency``, converts to the org's
``display_currency`` via the rate table, and stores the result on
the run log. All aggregations stay simple sums in the org's display
currency.

New table:
- ``agents_currency_rates``    - per-org manual exchange rates

Columns added:
- ``agents_model_pricing.currency``     ("USD" default; future Azure
  EU rows opt into "EUR")
- ``agents_runtime_settings.display_currency`` ("EUR" default)
- ``agents_run_logs.cost_currency``     (NULL when cost is null)
- ``agents_budgets.currency``           ("EUR" default)
- ``agents_user_quotas.currency``       ("EUR" default)

Renames:
- ``agents_run_logs.cost_usd``           -> ``cost``
- ``agents_budgets.monthly_limit_usd``   -> ``monthly_limit``
- ``agents_user_quotas.daily_limit_usd`` -> ``daily_limit``
- ``agents_user_quotas.monthly_limit_usd`` -> ``monthly_limit``

``agents_model_pricing`` columns were already currency-neutral
(``input_per_1m`` etc.) when introduced in migration 035, so no rename
is needed here -- only the companion ``currency`` column is added.

The branch is pre-launch with no production data, so renames happen
directly without a copy-and-drop dance.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "037"
down_revision: str = "036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply multi-currency schema."""
    op.create_table(
        "agents_currency_rates",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("from_currency", sa.String(3), nullable=False),
        sa.Column("to_currency", sa.String(3), nullable=False),
        sa.Column("rate", sa.Numeric(20, 10), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["login_organizations.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id",
            "from_currency",
            "to_currency",
            name="uq_agents_currency_rates_triple",
        ),
    )
    op.create_index(
        "ix_agents_currency_rates_org",
        "agents_currency_rates",
        ["organization_id"],
    )

    op.add_column(
        "agents_model_pricing",
        sa.Column(
            "currency",
            sa.String(3),
            nullable=False,
            server_default="USD",
        ),
    )
    op.add_column(
        "agents_runtime_settings",
        sa.Column(
            "display_currency",
            sa.String(3),
            nullable=False,
            server_default="EUR",
        ),
    )
    op.add_column(
        "agents_run_logs",
        sa.Column("cost_currency", sa.String(3), nullable=True),
    )
    op.add_column(
        "agents_budgets",
        sa.Column(
            "currency",
            sa.String(3),
            nullable=False,
            server_default="EUR",
        ),
    )
    op.add_column(
        "agents_user_quotas",
        sa.Column(
            "currency",
            sa.String(3),
            nullable=False,
            server_default="EUR",
        ),
    )

    op.alter_column("agents_run_logs", "cost_usd", new_column_name="cost")
    op.alter_column(
        "agents_budgets",
        "monthly_limit_usd",
        new_column_name="monthly_limit",
    )
    op.alter_column(
        "agents_user_quotas",
        "daily_limit_usd",
        new_column_name="daily_limit",
    )
    op.alter_column(
        "agents_user_quotas",
        "monthly_limit_usd",
        new_column_name="monthly_limit",
    )



def downgrade() -> None:
    """Reverse multi-currency schema."""
    op.alter_column(
        "agents_user_quotas",
        "monthly_limit",
        new_column_name="monthly_limit_usd",
    )
    op.alter_column(
        "agents_user_quotas",
        "daily_limit",
        new_column_name="daily_limit_usd",
    )
    op.alter_column(
        "agents_budgets",
        "monthly_limit",
        new_column_name="monthly_limit_usd",
    )
    op.alter_column("agents_run_logs", "cost", new_column_name="cost_usd")

    op.drop_column("agents_user_quotas", "currency")
    op.drop_column("agents_budgets", "currency")
    op.drop_column("agents_run_logs", "cost_currency")
    op.drop_column("agents_runtime_settings", "display_currency")
    op.drop_column("agents_model_pricing", "currency")

    op.drop_index(
        "ix_agents_currency_rates_org",
        table_name="agents_currency_rates",
    )
    op.drop_table("agents_currency_rates")
