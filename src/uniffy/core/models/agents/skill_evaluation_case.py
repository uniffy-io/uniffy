from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, Column, DateTime, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.content.model_mixins import deleted_at_field, is_deleted_field
from uniffy.core.types import generate_id


class AgentSkillEvaluationCase(SQLModel, table=True):
    __tablename__ = "agents_skill_evaluation_cases"
    __table_args__ = (
        CheckConstraint(
            "(skill_id IS NULL) <> (draft_id IS NULL)",
            name="ck_skill_evaluation_case_scope",
        ),
        Index("ix_skill_evaluation_cases_skill", "organization_id", "skill_id"),
        Index("ix_skill_evaluation_cases_draft", "organization_id", "draft_id"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False)
    owner_id: UUID = Field(foreign_key="login_users.id", nullable=False)
    skill_id: UUID | None = None
    draft_id: UUID | None = None
    fields: dict = Field(sa_column=Column(JSONB, nullable=False))
    is_deleted: bool = is_deleted_field()
    deleted_at: datetime | None = deleted_at_field()
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
