"""Agent skill model for agent instruction sets."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Index, String, Text, Uuid, text
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class AgentSkill(SQLModel, table=True):
    """A curated markdown instruction set injected into an agent's system prompt."""

    __tablename__ = "agents_skills"
    __table_args__ = (
        Index(
            "uq_agents_skills_org_name",
            "organization_id",
            "name",
            unique=True,
            postgresql_where=text("organization_id IS NOT NULL"),
        ),
        Index(
            "uq_agents_skills_bundled_name",
            "name",
            unique=True,
            postgresql_where=text("organization_id IS NULL"),
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID | None = Field(
        default=None,
        foreign_key="login_organizations.id",
        nullable=True,
        index=True,
    )
    name: str = Field(
        sa_column=Column(String(100), nullable=False),
    )
    display_name: str = Field(
        sa_column=Column(String(255), nullable=False),
    )
    description: str = Field(
        default="",
        sa_column=Column(Text(), nullable=False, server_default=text("''")),
    )
    content: str = Field(
        default="",
        sa_column=Column(Text(), nullable=False, server_default=text("''")),
    )
    source: str = Field(
        sa_column=Column(String(20), nullable=False),
    )
    owner_id: UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(), nullable=True),
    )
    always_active: bool = Field(default=False, nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    def __repr__(self) -> str:
        return (
            f"<AgentSkill(id={self.id}, name={self.name!r}, "
            f"source={self.source!r}, org_id={self.organization_id})>"
        )
