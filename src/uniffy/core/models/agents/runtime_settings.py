"""Per-organization agent runtime settings."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Boolean, Column, DateTime, Integer, String, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id

DEFAULT_SEND_DEADLINE_SECONDS = 300
DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5
DEFAULT_CIRCUIT_BREAKER_RECOVERY_SECONDS = 60


class AgentRuntimeSettings(SQLModel, table=True):
    """Per-org runtime knobs for the agents domain. Absent rows fall through to module defaults."""

    __tablename__ = "agents_runtime_settings"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            name="uq_agents_runtime_settings_org",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(nullable=False)
    send_deadline_seconds: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    failover_enabled: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False, default=True),
    )
    resume_enabled: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False, default=True),
    )
    circuit_breaker_failure_threshold: int = Field(
        default=DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
        sa_column=Column(Integer, nullable=False, default=DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD),
    )
    circuit_breaker_recovery_seconds: int = Field(
        default=DEFAULT_CIRCUIT_BREAKER_RECOVERY_SECONDS,
        sa_column=Column(Integer, nullable=False, default=DEFAULT_CIRCUIT_BREAKER_RECOVERY_SECONDS),
    )
    display_currency: str = Field(
        default="EUR",
        sa_column=Column(String(3), nullable=False, default="EUR"),
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
            f"<AgentRuntimeSettings(org={self.organization_id}, "
            f"deadline={self.send_deadline_seconds}, "
            f"failover={self.failover_enabled}, resume={self.resume_enabled})>"
        )
