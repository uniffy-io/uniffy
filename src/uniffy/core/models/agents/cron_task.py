"""Agent cron task model for scheduled recurring agent executions."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Enum, ForeignKey, Index, String, Text, text
from sqlmodel import Field, SQLModel

from uniffy.core.content.model_mixins import deleted_at_field, is_deleted_field
from uniffy.core.types import AccessMode, ContentRole, generate_id


class AgentCronTask(SQLModel, table=True):
    """A scheduled recurring task that an agent executes on behalf of a user."""

    __tablename__ = "agents_cron_tasks"
    __table_args__ = (
        Index(
            "ix_agents_cron_tasks_due",
            "organization_id",
            "next_run_at",
            postgresql_where=text("is_enabled = true AND is_deleted = false"),
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    owner_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    agent_id: UUID = Field(
        sa_column=Column(
            ForeignKey("agents_agents.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    execution_user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    session_id: UUID | None = Field(
        default=None,
        sa_column=Column(
            ForeignKey("agents_sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    name: str = Field(
        sa_column=Column(String(255), nullable=False),
    )
    description: str = Field(
        default="",
        sa_column=Column(Text, nullable=False, server_default=text("''")),
    )
    prompt: str = Field(
        sa_column=Column(Text, nullable=False),
    )
    cron_expression: str = Field(
        sa_column=Column(String(100), nullable=False),
    )
    timezone: str = Field(
        default="UTC",
        sa_column=Column(String(100), nullable=False, server_default=text("'UTC'")),
    )
    is_enabled: bool = Field(default=True, nullable=False)
    last_run_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    next_run_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    last_run_status: str | None = Field(
        default=None,
        sa_column=Column(String(20), nullable=True),
    )
    last_run_error: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    run_count: int = Field(default=0, nullable=False)
    consecutive_failures: int = Field(default=0, nullable=False)
    max_consecutive_failures: int = Field(default=3, nullable=False)
    access_mode: AccessMode | None = Field(
        default=None,
        sa_column=Column(
            Enum(
                AccessMode,
                name="accessmode",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,
            ),
            nullable=True,
            index=True,
        ),
    )
    baseline_role: ContentRole | None = Field(
        default=None,
        sa_column=Column(
            Enum(
                ContentRole,
                name="contentrole",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,
            ),
            nullable=True,
        ),
    )
    is_deleted: bool = is_deleted_field()
    deleted_at: datetime | None = deleted_at_field()
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
            f"<AgentCronTask(id={self.id}, name={self.name!r}, "
            f"cron={self.cron_expression!r}, enabled={self.is_enabled})>"
        )
