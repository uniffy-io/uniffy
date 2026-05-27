"""Agent budget alert dedupe model."""

from datetime import UTC, date, datetime
from uuid import UUID

from sqlalchemy import Column, Date, DateTime, Index, Integer, String, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class AgentBudgetAlert(SQLModel, table=True):
    """A fired budget alert; the unique constraint prevents re-alerting within a period."""

    __tablename__ = "agents_budget_alerts"
    __table_args__ = (
        UniqueConstraint(
            "scope",
            "organization_id",
            "user_id",
            "period_start",
            "threshold",
            "kind",
            name="uq_agents_budget_alerts_scope_key",
        ),
        Index(
            "ix_agents_budget_alerts_org_period",
            "organization_id",
            "period_start",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    scope: str = Field(
        sa_column=Column(String(16), nullable=False),
    )
    organization_id: UUID = Field(nullable=False)
    user_id: UUID | None = Field(default=None, nullable=True)
    period_start: date = Field(
        sa_column=Column(Date, nullable=False),
    )
    threshold: int = Field(
        sa_column=Column(Integer, nullable=False),
    )
    kind: str = Field(
        sa_column=Column(String(16), nullable=False),
    )
    fired_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    def __repr__(self) -> str:
        return (
            f"<AgentBudgetAlert(scope={self.scope!r}, org={self.organization_id}, "
            f"period={self.period_start}, threshold={self.threshold}, kind={self.kind!r})>"
        )
