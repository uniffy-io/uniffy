"""Agent cron run log model for recording scheduled task executions."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, Text
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class AgentCronRunLog(SQLModel, table=True):
    """A log entry recording a single cron task execution."""

    __tablename__ = "agents_cron_run_logs"
    __table_args__ = (
        Index(
            "ix_agents_cron_run_logs_task_started",
            "cron_task_id",
            "started_at",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    cron_task_id: UUID = Field(
        sa_column=Column(
            ForeignKey("agents_cron_tasks.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    organization_id: UUID = Field(nullable=False, index=True)
    agent_run_log_id: UUID | None = Field(
        default=None,
        sa_column=Column(
            ForeignKey("agents_run_logs.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    session_id: UUID = Field(nullable=False)
    status: str = Field(
        sa_column=Column(String(20), nullable=False),
    )
    error: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    result_summary: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    started_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    completed_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    input_tokens: int = Field(default=0, nullable=False)
    output_tokens: int = Field(default=0, nullable=False)

    def __repr__(self) -> str:
        return (
            f"<AgentCronRunLog(id={self.id}, task_id={self.cron_task_id}, status={self.status!r})>"
        )
