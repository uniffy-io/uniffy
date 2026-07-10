"""Per-run skill attribution row; the evolution analyzer's quality signal."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Boolean, Column, DateTime, Index, Integer, Uuid, text
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class AgentSkillUsage(SQLModel, table=True):
    """Records that a skill was injected, viewed, or invoked on one agent run."""

    __tablename__ = "agents_skill_usages"
    __table_args__ = (
        Index("ix_agents_skill_usages_skill_created", "skill_id", "created_at"),
        Index("ix_agents_skill_usages_session", "session_id"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    run_log_id: UUID | None = Field(default=None, sa_column=Column(Uuid(), nullable=True))
    session_id: UUID | None = Field(default=None, sa_column=Column(Uuid(), nullable=True))
    skill_id: UUID = Field(sa_column=Column(Uuid(), nullable=False))
    skill_version: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, server_default=text("0")),
    )
    agent_id: UUID = Field(sa_column=Column(Uuid(), nullable=False))
    user_id: UUID = Field(sa_column=Column(Uuid(), nullable=False))
    organization_id: UUID = Field(sa_column=Column(Uuid(), nullable=False))
    injected: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default=text("false")),
    )
    viewed: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default=text("false")),
    )
    # User ran the skill via the slash menu - the strongest quality signal.
    invoked: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default=text("false")),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    def __repr__(self) -> str:
        return (
            f"<AgentSkillUsage(skill_id={self.skill_id}, v={self.skill_version}, "
            f"injected={self.injected}, viewed={self.viewed}, invoked={self.invoked})>"
        )
