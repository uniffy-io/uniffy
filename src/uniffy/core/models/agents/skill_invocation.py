"""Exact-version observations retained independently of skill and conversation deletion."""

from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import CheckConstraint, Column, DateTime, Index, String, text
from sqlmodel import Field, SQLModel

from uniffy.core.models.agents.skill import SkillSurface
from uniffy.core.types import generate_id


class SkillInvocationStatus(StrEnum):
    STARTED = "started"
    COMPLETED = "completed"
    FAILED = "failed"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


class SkillInvocationSource(StrEnum):
    USER = "user"


class SkillInvocationErrorCode(StrEnum):
    MISSING_TOOLS = "missing_tools"
    UNSUPPORTED_SURFACE = "unsupported_surface"
    PROVIDER_FAILURE = "provider_failure"
    DEADLINE_EXCEEDED = "deadline_exceeded"
    CANCELLED = "cancelled"
    RUN_FAILURE = "run_failure"
    INCOMPLETE = "incomplete"


class AgentSkillInvocation(SQLModel, table=True):
    __tablename__ = "agents_skill_invocations"
    __table_args__ = (
        CheckConstraint(
            "status IN ('started', 'completed', 'failed', 'rejected', 'cancelled')",
            name="ck_agents_skill_invocations_status",
        ),
        CheckConstraint("source = 'user'", name="ck_agents_skill_invocations_source"),
        CheckConstraint(
            "(surface = 'session' AND session_id IS NOT NULL AND channel_id IS NULL) OR "
            "(surface = 'chat' AND channel_id IS NOT NULL AND session_id IS NULL)",
            name="ck_agents_skill_invocations_destination",
        ),
        CheckConstraint(
            "(status = 'started' AND completed_at IS NULL) OR "
            "(status <> 'started' AND completed_at IS NOT NULL)",
            name="ck_agents_skill_invocations_terminal",
        ),
        CheckConstraint(
            "skill_version_number > 0 AND tool_error_count >= 0",
            name="ck_agents_skill_invocations_counts",
        ),
        Index("ix_agents_skill_invocations_org_created", "organization_id", "created_at"),
        Index(
            "ix_agents_skill_invocations_skill_version_created",
            "skill_id",
            "skill_version_number",
            "created_at",
        ),
        Index("ix_agents_skill_invocations_agent_created", "agent_id", "created_at"),
        Index(
            "ix_agents_skill_invocations_response",
            "organization_id",
            "surface",
            "response_message_id",
            postgresql_where=text("response_message_id IS NOT NULL"),
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True)
    organization_id: UUID
    user_id: UUID
    agent_id: UUID
    skill_id: UUID
    skill_version_id: UUID
    skill_version_number: int
    source: SkillInvocationSource = Field(
        default=SkillInvocationSource.USER,
        sa_column=Column(String(16), nullable=False),
    )
    surface: SkillSurface = Field(sa_column=Column(String(16), nullable=False))
    session_id: UUID | None = None
    channel_id: UUID | None = None
    trigger_message_id: UUID | None = None
    status: SkillInvocationStatus = Field(
        default=SkillInvocationStatus.STARTED,
        sa_column=Column(String(16), nullable=False),
    )
    error_code: SkillInvocationErrorCode | None = Field(
        default=None,
        sa_column=Column(String(32), nullable=True),
    )
    tool_error_count: int = 0
    run_log_id: UUID | None = None
    response_message_id: UUID | None = None
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    completed_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
