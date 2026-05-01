"""Agent model pricing configuration.

One row per ``(provider, model, effective_from)`` triple. Cost
computation looks up the row where ``effective_from <= run.created_at``
and ``effective_to`` is either null or in the future, so historical run
logs keep their priced cost even after new pricing lands.
"""

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import Column, DateTime, Index, Numeric, String, UniqueConstraint
from sqlalchemy.types import JSON
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class AgentModelPricing(SQLModel, table=True):
    """Pricing record for a single provider + model.

    Attributes
    ----------
    id : UUID
        Primary key (UUIDv7).
    provider : str
        ``anthropic``, ``openai``, ``google`` (or ``other``).
    model : str
        Provider-specific model id (e.g. ``claude-sonnet-4-6``).
    kind : str
        ``text`` or ``image``. Text models use the four per-1M-token
        rates; image models use ``image_prices``.
    input_per_1m_usd : Decimal | None
        Text: price per 1M input tokens.
    output_per_1m_usd : Decimal | None
        Text: price per 1M output tokens.
    cached_input_per_1m_usd : Decimal | None
        Text: discounted rate for prompt-cache reads. Null means cached
        inputs are priced at the regular input rate.
    thinking_per_1m_usd : Decimal | None
        Text: surcharge rate for extended-thinking tokens. Null means
        thinking tokens are priced at the regular output rate.
    image_prices : dict | None
        Image: nested JSON like ``{"1024x1024": {"auto": 0.04}, ...}``.
    effective_from : datetime
        Earliest ``created_at`` that should use this row.
    effective_to : datetime | None
        Earliest ``created_at`` that should NOT use this row; null means
        currently active.
    created_at : datetime
        When this pricing row was inserted.
    updated_at : datetime
        When this pricing row was last modified.

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
    input_per_1m_usd: Decimal | None = Field(
        default=None,
        sa_column=Column(Numeric(10, 4), nullable=True),
    )
    output_per_1m_usd: Decimal | None = Field(
        default=None,
        sa_column=Column(Numeric(10, 4), nullable=True),
    )
    cached_input_per_1m_usd: Decimal | None = Field(
        default=None,
        sa_column=Column(Numeric(10, 4), nullable=True),
    )
    thinking_per_1m_usd: Decimal | None = Field(
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
        """Return string representation of AgentModelPricing."""
        return (
            f"<AgentModelPricing(provider={self.provider!r}, model={self.model!r}, "
            f"kind={self.kind!r}, effective_from={self.effective_from})>"
        )
