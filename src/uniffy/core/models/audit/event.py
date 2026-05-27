"""AuditEvent model: central append-only audit log for the whole product."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, String
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class AuditEvent(SQLModel, table=True):
    """An append-only audit log entry recording a single mutation.
    Range-partitioned monthly on ``created_at``.
    """

    __tablename__ = "audit_events"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID | None = Field(default=None)
    actor_user_id: UUID | None = Field(default=None)
    actor_org_role: str | None = Field(
        default=None,
        sa_column=Column(String(32), nullable=True),
    )
    on_behalf_of_user_id: UUID | None = Field(default=None)
    action: str = Field(
        sa_column=Column(String(64), nullable=False),
    )
    resource_type: str | None = Field(
        default=None,
        sa_column=Column(String(32), nullable=True),
    )
    resource_id: UUID | None = Field(default=None)
    details: dict = Field(
        default_factory=dict,
        sa_column=Column(JSONB, nullable=False, server_default="{}"),
    )
    ip_address: str | None = Field(
        default=None,
        sa_column=Column(INET, nullable=True),
    )
    user_agent: str | None = Field(
        default=None,
        sa_column=Column(String(512), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    def __repr__(self) -> str:
        return (
            f"<AuditEvent(id={self.id}, action={self.action!r}, "
            f"actor={self.actor_user_id}, org={self.organization_id}, "
            f"created_at={self.created_at})>"
        )
