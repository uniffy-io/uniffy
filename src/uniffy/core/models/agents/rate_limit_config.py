"""Agent rate limit configuration model."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Index, Integer, String, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class AgentRateLimitConfig(SQLModel, table=True):
    """Per-organization rate limit override for the agents domain."""

    __tablename__ = "agents_rate_limits"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "limit_kind",
            name="uq_agents_rate_limits_org_kind",
        ),
        Index(
            "ix_agents_rate_limits_org",
            "organization_id",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(nullable=False)
    limit_kind: str = Field(
        sa_column=Column(String(32), nullable=False),
    )
    limit: int = Field(
        sa_column=Column(Integer, nullable=False),
    )
    window_seconds: int = Field(
        sa_column=Column(Integer, nullable=False),
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
            f"<AgentRateLimitConfig(org={self.organization_id}, "
            f"kind={self.limit_kind!r}, limit={self.limit}/{self.window_seconds}s)>"
        )
