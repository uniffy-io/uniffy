"""Agent model pricing configuration."""

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import Column, DateTime, Index, Numeric, String, UniqueConstraint
from sqlalchemy.types import JSON
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class AgentModelPricing(SQLModel, table=True):
    """Pricing record for a single provider + model. Versioned by
    ``effective_from`` / ``effective_to``.
    """

    __tablename__ = "agents_model_pricing"
    __table_args__ = (
        UniqueConstraint(
            "provider",
            "model",
            "effective_from",
            name="uq_agents_model_pricing_provider_model_from",
        ),
        Index(
            "ix_agents_model_pricing_lookup",
            "provider",
            "model",
            "effective_from",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    provider: str = Field(
        sa_column=Column(String(50), nullable=False),
    )
    model: str = Field(
        sa_column=Column(String(100), nullable=False),
    )
    kind: str = Field(
        sa_column=Column(String(20), nullable=False),
    )
    currency: str = Field(
        default="USD",
        sa_column=Column(String(3), nullable=False, default="USD"),
    )
    input_per_1m: Decimal | None = Field(
        default=None,
        sa_column=Column(Numeric(10, 4), nullable=True),
    )
    output_per_1m: Decimal | None = Field(
        default=None,
        sa_column=Column(Numeric(10, 4), nullable=True),
    )
    cached_input_per_1m: Decimal | None = Field(
        default=None,
        sa_column=Column(Numeric(10, 4), nullable=True),
    )
    thinking_per_1m: Decimal | None = Field(
        default=None,
        sa_column=Column(Numeric(10, 4), nullable=True),
    )
    image_prices: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    effective_from: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    effective_to: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
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
            f"<AgentModelPricing(provider={self.provider!r}, model={self.model!r}, "
            f"kind={self.kind!r}, effective_from={self.effective_from})>"
        )
