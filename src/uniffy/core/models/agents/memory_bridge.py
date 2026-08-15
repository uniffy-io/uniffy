"""Opt-in row: this user's personal agent memory may be read in shared spaces."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel


class AgentMemoryBridgeOptIn(SQLModel, table=True):
    __tablename__ = "agents_memory_bridge_optins"

    user_id: UUID = Field(foreign_key="login_users.id", primary_key=True, nullable=False)
    organization_id: UUID = Field(
        foreign_key="login_organizations.id", primary_key=True, nullable=False
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
