"""Per-organization agent runtime settings.

Holds tunables and feature flags for the runtime: end-to-end stream
deadline, failover toggle, resume toggle, circuit breaker thresholds.
Absent rows fall through to module-level defaults so the runtime can
operate on orgs that have never been configured.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Boolean, Column, DateTime, Integer, String, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id

DEFAULT_SEND_DEADLINE_SECONDS = 300
DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5
DEFAULT_CIRCUIT_BREAKER_RECOVERY_SECONDS = 60


class AgentRuntimeSettings(SQLModel, table=True):
    """Per-org runtime knobs for the agents domain.

    Attributes
    ----------
    id : UUID
        Primary key (UUIDv7).
    organization_id : UUID
        Unique key: one row per organization.
    send_deadline_seconds : int | None
        End-to-end deadline for ``send_message`` / ``stream_send_message``.
        Null means use the module-level default
        (``DEFAULT_SEND_DEADLINE_SECONDS``).
    failover_enabled : bool
        When true the runtime retries on a sibling provider key after a
        retryable provider failure. When false the runtime makes a single
        attempt.
    resume_enabled : bool
        When true the runtime honors ``resume_after_seq`` on stream
        requests and replays buffered events. When false the field is
        ignored and the stream restarts from scratch.
    circuit_breaker_failure_threshold : int
        Trip a per-provider-key breaker after this many consecutive
        failures.
    circuit_breaker_recovery_seconds : int
        Half-open window (in seconds) after the breaker trips.
    created_at, updated_at : datetime
        Row timestamps.

    """

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
        """Return string representation of AgentRuntimeSettings."""
        return (
            f"<AgentRuntimeSettings(org={self.organization_id}, "
            f"deadline={self.send_deadline_seconds}, "
            f"failover={self.failover_enabled}, resume={self.resume_enabled})>"
        )
