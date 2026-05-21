"""AuditEvent model: central append-only audit log for the whole product.

Every security- or admin-relevant mutation across every domain writes a
row here through ``core.audit.writer.write_audit_event``. Rows are
immutable: no updates, no deletes (except by the partition-purge job).

No foreign keys. The audit log must survive deletion of users, orgs, or
content - history is immutable. Polymorphic ``resource_type`` /
``resource_id`` columns identify the target of the action; action-
specific structured data lives in the ``details`` JSONB column.

The table is range-partitioned by month on ``created_at``. Monthly
partitions are pre-created by ``039_audit_events.py`` and rolled
forward by a cron job in a later phase. Indexes are local to each
partition (created at table-creation time).
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, String
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class AuditEvent(SQLModel, table=True):
    """An append-only audit log entry recording a single mutation.

    Attributes
    ----------
    id : UUID
        Unique identifier (UUIDv7, sorts chronologically).
    organization_id : UUID | None
        Organization in which the action occurred. ``None`` for events
        that genuinely lack tenant context - login failures for unknown
        emails, system jobs running outside any org. Filtered queries
        from the admin page (which is always org-scoped) skip these
        rows; system admins can query them directly via the
        cross-org branch of the handler.
    actor_user_id : UUID | None
        Human user who initiated the action. ``None`` for system-driven
        events (cron jobs, retention purges). For agent-initiated actions
        this is the agent's human owner; the agent's identity is recorded
        in ``details.agent_id``.
    actor_org_role : str | None
        Snapshot of the actor's organization role at the time of the
        action. Preserved even if their role changes later. ``None``
        when the actor has no organization membership at write time
        (system events, deleted user mid-action).
    on_behalf_of_user_id : UUID | None
        Reserved for delegated-admin or system-initiated security-response
        flows where the actor differs from the beneficiary. Unused in v1.
    action : str
        Dotted action identifier (e.g. ``"permissions.member_added"``,
        ``"agent.tool_call.notes.create_note"``). See
        :mod:`uniffy.core.audit.actions` for the canonical catalogue.
    resource_type : str | None
        Polymorphic resource type (free string - matches
        :class:`ContentType` values where applicable, or domain-specific
        identifiers like ``"USER"`` for membership events).
    resource_id : UUID | None
        Identifier of the affected resource.
    details : dict
        JSONB blob carrying action-specific structured data. Always
        present; defaults to ``{}``.
    ip_address : IPv4Address | IPv6Address | None
        Client IP captured from the request context. ``None`` for
        system-initiated events.
    user_agent : str | None
        Client user-agent captured from the request context. Truncated
        to 512 chars.
    created_at : datetime
        When the event was recorded. Partition key (monthly RANGE).

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
        """Return string representation of AuditEvent."""
        return (
            f"<AuditEvent(id={self.id}, action={self.action!r}, "
            f"actor={self.actor_user_id}, org={self.organization_id}, "
            f"created_at={self.created_at})>"
        )
