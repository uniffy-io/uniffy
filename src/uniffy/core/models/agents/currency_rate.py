"""Per-organization manual currency exchange rates.

Admins enter rates manually via the budgets admin page. The runtime
consults this table when a pricing row's currency differs from the
org's display currency. No conversion paths are inferred; if the admin
needs both ``USD -> EUR`` and ``EUR -> USD`` they enter both rows.
"""

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Column, DateTime, Index, Numeric, String, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class AgentCurrencyRate(SQLModel, table=True):
    """Manual exchange rate row scoped to a single organization.

    Attributes
    ----------
    id : UUID
        Primary key (UUIDv7).
    organization_id : UUID
        Org that owns this rate. Rates do not cross organizations.
    from_currency : str
        ISO 4217 source currency code (e.g. ``"USD"``).
    to_currency : str
        ISO 4217 target currency code (e.g. ``"EUR"``).
    rate : Decimal
        Multiplier applied to amounts in ``from_currency`` to get an
        amount in ``to_currency``. Stored at 10 decimal places of
        precision.
    updated_at : datetime
        Last write timestamp; surfaced in the admin UI so operators can
        spot stale rates.
    """

    __tablename__ = "agents_currency_rates"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "from_currency",
            "to_currency",
            name="uq_agents_currency_rates_triple",
        ),
        Index(
            "ix_agents_currency_rates_org",
            "organization_id",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(nullable=False)
    from_currency: str = Field(
        sa_column=Column(String(3), nullable=False),
    )
    to_currency: str = Field(
        sa_column=Column(String(3), nullable=False),
    )
    rate: Decimal = Field(
        sa_column=Column(Numeric(20, 10), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    def __repr__(self) -> str:
        """Return string representation of AgentCurrencyRate."""
        return (
            f"<AgentCurrencyRate(org={self.organization_id}, "
            f"{self.from_currency}->{self.to_currency}={self.rate})>"
        )
