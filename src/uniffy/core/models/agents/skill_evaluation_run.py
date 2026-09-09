from datetime import UTC, datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class SkillEvaluationStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    PASSED = "passed"
    FAILED = "failed"
    INCONCLUSIVE = "inconclusive"
    ERROR = "error"


class SkillEvaluationError(StrEnum):
    QUEUE_UNAVAILABLE = "queue_unavailable"
    PROVIDER_REQUIRED = "provider_required"
    ACCESS_REVOKED = "access_revoked"
    BUDGET_EXCEEDED = "budget_exceeded"
    INTERRUPTED = "interrupted"
    PROVIDER_ERROR = "provider_error"
    INVALID_RESPONSE = "invalid_response"


OPEN_EVALUATION_STATUSES = (SkillEvaluationStatus.QUEUED, SkillEvaluationStatus.RUNNING)


class AgentSkillEvaluationRun(SQLModel, table=True):
    __tablename__ = "agents_skill_evaluation_runs"
    __table_args__ = (
        CheckConstraint(
            "(skill_version_id IS NULL) <> (draft_id IS NULL)",
            name="ck_skill_evaluation_run_target",
        ),
        CheckConstraint(
            "skill_version_id IS NULL OR (skill_id IS NOT NULL AND version_number > 0)",
            name="ck_skill_evaluation_run_version",
        ),
        CheckConstraint(
            "status IN ('queued', 'running', 'passed', 'failed', 'inconclusive', 'error')",
            name="ck_skill_evaluation_run_status",
        ),
        UniqueConstraint(
            "organization_id", "request_id", "case_id", name="uq_skill_evaluation_request_case"
        ),
        Index("ix_skill_evaluation_runs_skill", "organization_id", "agent_id", "skill_id", "id"),
        Index("ix_skill_evaluation_runs_draft", "organization_id", "agent_id", "draft_id", "id"),
        Index(
            "ix_skill_evaluation_runs_deadline",
            "deadline_at",
            postgresql_where=text("status IN ('queued', 'running')"),
        ),
        Index(
            "ix_skill_evaluation_runs_open_org",
            "organization_id",
            postgresql_where=text("status IN ('queued', 'running')"),
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False)
    owner_id: UUID = Field(foreign_key="login_users.id", nullable=False)
    request_id: UUID
    request_digest: str = Field(max_length=64)
    case_id: UUID
    agent_id: UUID
    skill_id: UUID | None = None
    skill_version_id: UUID | None = None
    version_number: int = 0
    draft_id: UUID | None = None
    target_digest: str = Field(max_length=64)
    snapshot: dict = Field(sa_column=Column(JSONB, nullable=False))
    status: SkillEvaluationStatus = Field(
        default=SkillEvaluationStatus.QUEUED,
        sa_column=Column(String(16), nullable=False),
    )
    error: SkillEvaluationError | None = Field(
        default=None, sa_column=Column(String(32), nullable=True)
    )
    output: str = Field(default="", sa_column=Column(Text, nullable=False))
    observations: dict = Field(default_factory=dict, sa_column=Column(JSONB, nullable=False))
    judge_result: dict = Field(default_factory=dict, sa_column=Column(JSONB, nullable=False))
    model: str = Field(default="", max_length=255)
    run_log_id: UUID | None = None
    cost: Decimal | None = Field(default=None, sa_column=Column(Numeric(12, 6), nullable=True))
    cost_currency: str | None = Field(default=None, max_length=3)
    input_tokens: int = 0
    output_tokens: int = 0
    duration_ms: int = 0
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    started_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    completed_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    deadline_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
