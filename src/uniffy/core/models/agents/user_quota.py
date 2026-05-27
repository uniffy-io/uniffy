"""Per-user agent quota within an organization."""

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class AgentUserQuota(SQLModel, table=True):
    """Per-user dollar and image caps within an organization."""

    __tablename__ = "agents_user_quotas"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "user_id",
            name="uq_agents_user_quotas_org_user",
        ),
        Index(
            "ix_agents_user_quotas_user",
            "user_id",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(nullable=False)
    user_id: UUID = Field(nullable=False)
    daily_limit: Decimal | None = Field(
        default=None,
        sa_column=Column(Numeric(10, 2), nullable=True),
    )
    monthly_limit: Decimal | None = Field(
        default=None,
        sa_column=Column(Numeric(10, 2), nullable=True),
    )
    currency: str = Field(
        default="EUR",
        sa_column=Column(String(3), nullable=False, default="EUR"),
    )
    daily_image_limit: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    monthly_image_limit: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    hard_limit: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, default=False),
    )
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
            f"<AgentUserQuota(org={self.organization_id}, "
            f"user={self.user_id}, hard_limit={self.hard_limit})>"
        )
