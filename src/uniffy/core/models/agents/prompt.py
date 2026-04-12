"""Agent prompt model for reusable instruction templates."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Enum, Index, String, Text, Uuid, text
from sqlmodel import Field, SQLModel

from uniffy.core.types import AccessMode, ContentRole, generate_id


class AgentPrompt(SQLModel, table=True):
    """
    A reusable instruction template that defines agent behavior.

    Unlike skills (which are injected alongside the soul prompt),
    prompts are standalone instruction sets that can replace or
    augment the soul prompt entirely.

    Attributes
    ----------
    id : UUID
        Unique identifier (primary key, UUIDv7).
    organization_id : UUID | None
        Organization this prompt belongs to. None for bundled prompts.
    name : str
        Unique machine name within scope (max 100 chars).
    display_name : str
        Human-readable name (max 255 chars).
    description : str
        Short description of what the prompt does.
    content : str
        Markdown instructions for the system prompt.
    source : str
        "bundled" (shipped with app), "organization" (created by admin), or "personal".
    owner_id : UUID | None
        Owner user ID for personal prompts. None for org/bundled prompts.
    created_at : datetime
        When the prompt was created.
    updated_at : datetime
        When the prompt was last updated.

    """

    __tablename__ = "agents_prompts"
    __table_args__ = (
        Index(
            "uq_agents_prompts_org_name",
            "organization_id",
            "name",
            unique=True,
            postgresql_where=text("organization_id IS NOT NULL"),
        ),
        Index(
            "uq_agents_prompts_bundled_name",
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
    created_by: UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    def __repr__(self) -> str:
        """Return string representation of AgentPrompt."""
        return (
            f"<AgentPrompt(id={self.id}, name={self.name!r}, "
            f"source={self.source!r}, org_id={self.organization_id})>"
        )
