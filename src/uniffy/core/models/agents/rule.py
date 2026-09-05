"""Reusable rule definitions; enablement belongs to organizations and agents."""

from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Index,
    Integer,
    String,
    Text,
    Uuid,
    text,
)
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class RuleSource(StrEnum):
    BUNDLED = "bundled"
    ORGANIZATION = "organization"


class RuleStatus(StrEnum):
    ACTIVE = "active"
    RETIRED = "retired"


class AgentRule(SQLModel, table=True):
    __tablename__ = "agents_rules"
    __table_args__ = (
        CheckConstraint(
            "(source = 'bundled' AND organization_id IS NULL) OR "
            "(source = 'organization' AND organization_id IS NOT NULL)",
            name="ck_agents_rules_source_scope",
        ),
        CheckConstraint("status IN ('active', 'retired')", name="ck_agents_rules_status"),
        Index(
            "uq_agents_rules_org_name",
            "organization_id",
            "name",
            unique=True,
            postgresql_where=text("organization_id IS NOT NULL"),
        ),
        Index(
            "uq_agents_rules_bundled_name",
            "name",
            unique=True,
            postgresql_where=text("organization_id IS NULL"),
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True)
    organization_id: UUID | None = Field(
        default=None, foreign_key="login_organizations.id", index=True
    )
    source: RuleSource = Field(sa_column=Column(String(20), nullable=False))
    name: str = Field(sa_column=Column(String(100), nullable=False))
    display_name: str = Field(sa_column=Column(String(255), nullable=False))
    description: str = Field(default="", sa_column=Column(Text, nullable=False, server_default=""))
    content: str = Field(default="", sa_column=Column(Text, nullable=False, server_default=""))
    status: RuleStatus = Field(
        default=RuleStatus.ACTIVE,
        sa_column=Column(String(16), nullable=False, server_default="active"),
    )
    latest_version_number: int = Field(
        default=1, sa_column=Column(Integer, nullable=False, server_default="1")
    )
    active_version_id: UUID | None = Field(
        default=None, sa_column=Column(Uuid, nullable=True, index=True)
    )
    active_version_pinned: bool = Field(
        default=False, sa_column=Column(Boolean, nullable=False, server_default=text("false"))
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True), nullable=False, onupdate=lambda: datetime.now(UTC)
        ),
    )
