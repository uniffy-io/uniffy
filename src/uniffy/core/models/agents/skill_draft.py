"""Pending skill draft awaiting user review; one path for user- and agent-authored drafts."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Boolean, Column, DateTime, Index, String, Text, Uuid, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.content.model_mixins import deleted_at_field, is_deleted_field
from uniffy.core.types import generate_id


class AgentSkillDraft(SQLModel, table=True):
    """A proposed create/edit/evolve of a skill, saved only on an explicit user action."""

    __tablename__ = "agents_skill_drafts"
    __table_args__ = (
        Index("ix_agents_skill_drafts_org_status", "organization_id", "status"),
        Index("ix_agents_skill_drafts_owner_status", "owner_id", "status"),
        Index("ix_agents_skill_drafts_target_skill", "target_skill_id"),
        Index("ix_agents_skill_drafts_channel", "channel_id"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    # No standalone index: the (organization_id, status) composite already
    # serves organization_id-prefix lookups.
    organization_id: UUID = Field(
        foreign_key="login_organizations.id",
        nullable=False,
    )
    # The reviewer/author who can save or discard this draft. For an
    # agent-proposed draft in a channel, this is the triggering user.
    owner_id: UUID = Field(foreign_key="login_users.id", nullable=False)
    # Null target = a create draft; set = an edit/evolve of that skill.
    target_skill_id: UUID | None = Field(default=None, sa_column=Column(Uuid(), nullable=True))
    kind: str = Field(sa_column=Column(String(16), nullable=False))
    proposed_by_agent_id: UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(), nullable=True),
    )
    session_id: UUID | None = Field(default=None, sa_column=Column(Uuid(), nullable=True))
    channel_id: UUID | None = Field(default=None, sa_column=Column(Uuid(), nullable=True))
    origin_chat_message_id: UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(), nullable=True),
    )
    evidence_message_ids: list = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False, server_default=text("'[]'::jsonb")),
    )
    rationale: str = Field(
        default="",
        sa_column=Column(Text(), nullable=False, server_default=text("''")),
    )
    name: str | None = Field(default=None, sa_column=Column(String(100), nullable=True))
    display_name: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
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
    suggested_scope: str = Field(
        default="personal",
        sa_column=Column(String(16), nullable=False, server_default=text("'personal'")),
    )
    suggested_always_active: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default=text("false")),
    )
    status: str = Field(
        default="pending",
        sa_column=Column(String(16), nullable=False, server_default=text("'pending'")),
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
            f"<AgentSkillDraft(id={self.id}, kind={self.kind!r}, "
            f"status={self.status!r}, target={self.target_skill_id})>"
        )
