"""Agent spend budget per organization."""

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.types import JSON
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class AgentBudget(SQLModel, table=True):
    """Per-organization spend and image budget; soft (warn-only) unless ``hard_limit`` is set."""

    __tablename__ = "agents_budgets"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            name="uq_agents_budgets_org",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(nullable=False)
    monthly_limit: Decimal | None = Field(
        default=None,
        sa_column=Column(Numeric(12, 2), nullable=True),
    )
    currency: str = Field(
        default="EUR",
        sa_column=Column(String(3), nullable=False, default="EUR"),
    )
    image_monthly_limit: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    hard_limit: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, default=False),
    )
    alert_thresholds: list[int] | None = Field(
        default_factory=lambda: [50, 75, 90],
        sa_column=Column(JSON, nullable=False, default=lambda: [50, 75, 90]),
    )
    reset_day: int = Field(default=1, nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    def __repr__(self) -> str:
        return (
            f"<AgentBudget(org={self.organization_id}, "
            f"monthly_limit={self.monthly_limit}, "
            f"hard_limit={self.hard_limit})>"
        )
