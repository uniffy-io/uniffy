"""Agent memory model for persistent cross-session memory."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Float, Index, String, Text, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class AgentMemory(SQLModel, table=True):
    """A persistent memory entry for an agent-user pair.

    Stores structured memories that persist across sessions,
    enabling agents to remember user preferences, facts,
    and context from previous interactions.

    Attributes
    ----------
    id : UUID
        Unique identifier (primary key, UUIDv7).
    agent_id : UUID
        Agent this memory belongs to.
    user_id : UUID
        User this memory is associated with.
    organization_id : UUID
        Organization context.
    key : str
        Unique key for this memory (per agent+user+org).
    content : str
        The memory content text.
    category : str
        Memory category: "preferences", "facts", "context", or "instructions".
    importance : float
        Importance weight (0.0 to 1.0, default 0.5).
    access_count : int
        Number of times this memory has been retrieved.
    created_at : datetime
        When the memory was first created.
    updated_at : datetime
        When the memory was last updated.

    """

    __tablename__ = "agents_memories"
    __table_args__ = (
        UniqueConstraint(
            "agent_id",
            "user_id",
            "organization_id",
            "key",
            name="uq_agents_memories_agent_user_org_key",
        ),
        Index(
            "ix_agents_memories_agent_user_org",
            "agent_id",
            "user_id",
            "organization_id",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    agent_id: UUID = Field(nullable=False)
    user_id: UUID = Field(nullable=False)
    organization_id: UUID = Field(nullable=False)
    key: str = Field(
        sa_column=Column(String(255), nullable=False),
    )
    content: str = Field(
        sa_column=Column(Text, nullable=False),
    )
    category: str = Field(
        sa_column=Column(String(50), nullable=False, default="facts"),
    )
    importance: float = Field(
        sa_column=Column(Float, nullable=False, default=0.5),
    )
    access_count: int = Field(default=0, nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    def __repr__(self) -> str:
        """Return string representation of AgentMemory."""
        return f"<AgentMemory(id={self.id}, key={self.key!r}, category={self.category!r})>"
