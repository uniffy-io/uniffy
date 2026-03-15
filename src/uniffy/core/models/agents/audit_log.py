"""Agent audit log model for recording agent-domain configuration changes."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Index, String
from sqlalchemy.types import JSON
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class AgentAuditLog(SQLModel, table=True):
    """A log entry recording a configuration change in the agents domain.

    Captures who changed what, when, and the details of the change.
    Used for security auditing of agent config, provider key, and
    skill modifications.

    Attributes
    ----------
    id : UUID
        Unique identifier (primary key, UUIDv7).
    organization_id : UUID
        Organization context.
    user_id : UUID
        User who performed the action.
    action : str
        Dot-separated action name (e.g. "agent.update", "provider_key.add").
    resource_type : str
        Type of resource affected ("agent", "provider_key", "skill").
    resource_id : UUID
        ID of the affected resource.
    details : dict | None
        JSONB with change details (e.g. changed fields, old/new values).
    created_at : datetime
        When the action occurred.

    """

    __tablename__ = "agents_audit_logs"
    __table_args__ = (
        Index(
            "ix_agents_audit_logs_org_created",
            "organization_id",
            "created_at",
        ),
        Index(
            "ix_agents_audit_logs_user_created",
            "user_id",
            "created_at",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(nullable=False)
    user_id: UUID = Field(nullable=False)
    action: str = Field(
        sa_column=Column(String(100), nullable=False),
    )
    resource_type: str = Field(
        sa_column=Column(String(50), nullable=False),
    )
    resource_id: UUID = Field(nullable=False)
    details: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    def __repr__(self) -> str:
        """Return string representation of AgentAuditLog."""
        return (
            f"<AgentAuditLog(id={self.id}, action={self.action!r}, "
            f"resource_type={self.resource_type!r}, resource_id={self.resource_id})>"
        )
