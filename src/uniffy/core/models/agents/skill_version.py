"""Immutable version snapshot of an agent skill."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class AgentSkillVersion(SQLModel, table=True):
    """One immutable snapshot of a skill's content + metadata; never mutated after insert."""

    __tablename__ = "agents_skill_versions"
    __table_args__ = (
        UniqueConstraint(
            "skill_id",
            "version_number",
            name="uq_agents_skill_versions_skill_version",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    # No standalone index: the (skill_id, version_number) unique constraint's
    # index already serves skill_id-prefix lookups (list versions for a skill).
    skill_id: UUID = Field(
        sa_column=Column(
            ForeignKey("agents_skills.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    version_number: int = Field(sa_column=Column(Integer, nullable=False))
    name: str = Field(sa_column=Column(String(100), nullable=False))
    display_name: str = Field(sa_column=Column(String(255), nullable=False))
    description: str = Field(
        default="",
        sa_column=Column(Text(), nullable=False, server_default=text("''")),
    )
    content: str = Field(
        default="",
        sa_column=Column(Text(), nullable=False, server_default=text("''")),
    )
    when_to_use: str = Field(
        default="",
        sa_column=Column(Text(), nullable=False, server_default=text("''")),
    )
    requires_tools: list = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False, server_default=text("'[]'::jsonb")),
    )
    requires_context: list = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False, server_default=text("'[]'::jsonb")),
    )
    author_id: UUID | None = Field(default=None, sa_column=Column(Uuid(), nullable=True))
    author_kind: str = Field(
        default="user",
        sa_column=Column(String(16), nullable=False, server_default=text("'user'")),
    )
    change_summary: str = Field(
        default="",
        sa_column=Column(Text(), nullable=False, server_default=text("''")),
    )
    parent_version_id: UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    def __repr__(self) -> str:
        return (
            f"<AgentSkillVersion(skill_id={self.skill_id}, "
            f"version={self.version_number}, name={self.name!r})>"
        )
