"""Agent model for AI agent configuration."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Enum, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.content.model_mixins import deleted_at_field, is_deleted_field
from uniffy.core.types import AccessMode, ContentRole, generate_id


class Agent(SQLModel, table=True):
    """
    An AI agent configuration scoped to an organization.

    Agents define model preferences, personality (soul prompt),
    and tool configuration for conversations.

    Attributes
    ----------
    id : UUID
        Unique identifier (primary key, UUIDv7).
    organization_id : UUID
        Organization this agent belongs to (FK to login_organizations).
    owner_id : UUID
        User who created this agent (FK to login_users).
    name : str
        Agent display name.
    soul_prompt : str
        Free-form personality, tone, and instruction text.
    primary_model : str
        Default model identifier (e.g. "claude-sonnet-4-6").
    fallback_models : list
        Ordered list of fallback model identifiers (JSONB).
    enabled_tools : list
        List of enabled tool identifiers (JSONB).
    enabled_skills : list
        List of enabled skill IDs (JSONB).
    avatar_emoji : str
        Emoji used as agent avatar.
    theme_color : str
        Theme color for agent UI representation.
    is_default : bool
        Whether this is the organization's default agent.
    created_at : datetime
        When the agent was created.
    updated_at : datetime
        When the agent was last updated.

    """

    __tablename__ = "agents_agents"
    __table_args__ = (
        Index(
            "uq_agents_agents_default_per_org",
            "organization_id",
            unique=True,
            postgresql_where=text("is_default = true"),
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    owner_id: UUID = Field(foreign_key="login_users.id", nullable=False)
    name: str = Field(
        sa_column=Column(String(255), nullable=False),
    )
    soul_prompt: str = Field(
        default="",
        sa_column=Column(Text(), nullable=False, server_default=text("''")),
    )
    primary_model: str = Field(
        default="claude-sonnet-4-6",
        sa_column=Column(String(100), nullable=False, server_default=text("'claude-sonnet-4-6'")),
    )
    fallback_models: list = Field(default_factory=list, sa_column=Column(JSONB, nullable=False))
    image_model: str = Field(
        default="",
        sa_column=Column(String(100), nullable=False, server_default=text("''")),
    )
    primary_provider_key_id: UUID | None = Field(
        default=None,
        sa_column=Column(
            ForeignKey("agents_provider_keys.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
    )
    image_provider_key_id: UUID | None = Field(
        default=None,
        sa_column=Column(
            ForeignKey("agents_provider_keys.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
    )
    prompt_id: UUID | None = Field(
        default=None,
        sa_column=Column(
            ForeignKey("agents_prompts.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
    )
    enabled_tools: list = Field(default_factory=list, sa_column=Column(JSONB, nullable=False))
    enabled_skills: list = Field(default_factory=list, sa_column=Column(JSONB, nullable=False))
    avatar_emoji: str = Field(
        default="",
        sa_column=Column(String(10), nullable=False, server_default=text("''")),
    )
    avatar_key: str | None = Field(
        default=None,
        sa_column=Column(String(255), nullable=True),
    )
    theme_color: str = Field(
        default="",
        sa_column=Column(String(50), nullable=False, server_default=text("''")),
    )
    is_default: bool = Field(default=False, nullable=False)
    access_mode: AccessMode = Field(
        default=AccessMode.OPEN_TO_ORG,
        sa_column=Column(
            Enum(
                AccessMode,
                name="accessmode",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,
            ),
            nullable=False,
            index=True,
        ),
    )
    baseline_role: ContentRole | None = Field(
        default=ContentRole.VIEWER,
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
        """Return string representation of Agent."""
        return f"<Agent(id={self.id}, name={self.name!r}, org_id={self.organization_id})>"
