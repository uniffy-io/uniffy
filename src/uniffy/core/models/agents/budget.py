"""Agent spend budget per organization.

One row per organization, created on demand the first time an admin
configures a budget. Soft limits (``hard_limit=False``) are the default:
usage is warn-only and the runtime will never reject a request based on
dollar spend. Admins opt into hard enforcement explicitly.
"""

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Integer,
    Numeric,
    UniqueConstraint,
)
from sqlalchemy.types import JSON
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class AgentBudget(SQLModel, table=True):
    """Per-organization spend and image budget.

    Attributes
    ----------
    id : UUID
        Primary key (UUIDv7).
    organization_id : UUID
        Unique key: one budget row per organization.
    monthly_limit_usd : Decimal | None
        Dollar cap per billing period. Null means no dollar cap.
    image_monthly_limit : int | None
        Count cap on image generations per billing period. Null means no
        cap; callers fall through to per-user defaults.
    hard_limit : bool
        When true the runtime rejects further activity once a limit is
        crossed. When false (default) usage is warn-only.
    alert_thresholds : list[int]
        Percent thresholds (of the monthly limit) at which an alert
        notification should fire. The 100% crossing always fires even
        when absent from this list because it coincides with hard
        enforcement. Default ``[50, 75, 90]``.
    reset_day : int
        Calendar day of month when the period rolls (1..28). Values
        beyond 28 clamp to the last day of a short month at read time.
    created_at, updated_at : datetime
        Row timestamps.

    """

    __tablename__ = "agents_budgets"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            name="uq_agents_budgets_org",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(nullable=False)
    monthly_limit_usd: Decimal | None = Field(
        default=None,
        sa_column=Column(Numeric(12, 2), nullable=True),
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
        """Return string representation of AgentBudget."""
        return (
            f"<AgentBudget(org={self.organization_id}, "
            f"monthly_limit_usd={self.monthly_limit_usd}, "
            f"hard_limit={self.hard_limit})>"
        )
