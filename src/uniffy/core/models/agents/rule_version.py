"""Immutable rule content snapshots."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, Uuid
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class AgentRuleVersion(SQLModel, table=True):
    __tablename__ = "agents_rule_versions"
    __table_args__ = (
        UniqueConstraint("rule_id", "version_number", name="uq_agents_rule_versions_number"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True)
    rule_id: UUID = Field(
        sa_column=Column(ForeignKey("agents_rules.id", ondelete="CASCADE"), nullable=False)
    )
    version_number: int = Field(sa_column=Column(Integer, nullable=False))
    name: str = Field(sa_column=Column(String(100), nullable=False))
    display_name: str = Field(sa_column=Column(String(255), nullable=False))
    description: str = Field(default="", sa_column=Column(Text, nullable=False, server_default=""))
    content: str = Field(default="", sa_column=Column(Text, nullable=False, server_default=""))
    author_id: UUID | None = Field(default=None, sa_column=Column(Uuid, nullable=True))
    change_summary: str = Field(
        default="", sa_column=Column(Text, nullable=False, server_default="")
    )
    parent_version_id: UUID | None = Field(default=None, sa_column=Column(Uuid, nullable=True))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
